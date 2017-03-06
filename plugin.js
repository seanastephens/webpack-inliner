const ConstDependency = require('webpack/lib/dependencies/ConstDependency');

const makeLogger = (requirers, module) => message =>
  console.log(
    'Not inlining',
    module.rawRequest,
    'into',
    requirers[0].rawRequest,
    ':',
    message
  );

function LeafModuleInlinerPlugin(options) {

}

LeafModuleInlinerPlugin.prototype.apply = function(compiler) {

  compiler.plugin('compilation', compilation => {
    const deadModules = new Set();

    compilation.plugin('optimize-modules', modules => {
      const moduleToRequirers = new Map();
      modules.forEach(sourceModule => {
        sourceModule.dependencies.forEach(({ module }) => {
          if(module !== null) {
            const refs = moduleToRequirers.get(module) || [];
            refs.push(sourceModule);
            moduleToRequirers.set(module, refs);
          }
        });
      });

      moduleToRequirers.forEach((requirers, module) => {

        const logReason = makeLogger(requirers, module);

        if(requirers.length > 1) {
          logReason(`Imported ${requirers.length} > 1 times.`);
          return;
        }

        if(module.dependencies.length > 0) {
          const estimate = module.dependencies.length / 2;
          logReason(`It has dependencies (estimated ${estimate} imports).`);
          return;
        }

        const inlineCandidate = compilation.getModule(module);
        const receiver = compilation.getModule(requirers[0]);

        if(!inlineCandidate._source) {
          logReason('Can\'t find source of inline candidate.');
          return;
        }

        const byPosition = (a, b) => a.range[0] - b.range[0];
        const sortedDeps = receiver.dependencies.slice().sort(byPosition);
        const relevantRequire = dep => dep.request === inlineCandidate.rawRequest;

        if(sortedDeps.filter(relevantRequire).length != 1) {
          // Being extra conservative here: If the import happens twice, we
          // can't inline because that would duplicate module state/side
          // effects. If it happens zero times, well, something else is wrong.
          logReason([
            'Receiver candidate imported the inline candidate',
            `${pairs.length} times, needs to be one.`
          ].join(' '));
          return;
        }

        const moduleIdDepIndex = sortedDeps.findIndex(relevantRequire);
        const moduleIdDep = sortedDeps[moduleIdDepIndex];
        const webpackHeaderDep = sortedDeps[moduleIdDepIndex - 1];

        if(moduleIdDep.type !== 'cjs require') {
          logReason([
            'Sanity check failed:',
            `moduleIdDep.type === ${moduleIdDep.type} !== 'cjs require',`,
          ].join(' '));
          return;
        }

        const depsAreAdjacent = webpackHeaderDep.range[1] === moduleIdDep.range[0] - 1;

        if(!depsAreAdjacent) {
          logReason(`Sanity check failed: pairIsAdjacent=${depsAreAdjacent}`);
          return;
        }

        console.log('Inlining', module.rawRequest, 'into', requirers[0].rawRequest);

        // We need to insert a statement after 'use strict', so we take it out
        // and then put it back in after.
        const insert = inlineCandidate._source.source()
          .replace(/['"]use strict['"];/g, '')
          .replace('module.exports', 'exports');

        const inlineModuleDefinition = [
          '(function() {',
          '  "use strict";',
          '  var exports = {};',
          `  ${insert}`,
          '  return exports;',
          '})()'
        ].join('\n');

        // The deps cover the ranges marked by '^', but we want to replace
        // the range covered by 'x':
        //
        // const foo = require('bar');
        //             ^^^^^^^ ^^^^^
        //             xxxxxxxxxxxxxx

        const range = [webpackHeaderDep.range[0], moduleIdDep.range[1] + 1];

        receiver.addDependency(new ConstDependency(inlineModuleDefinition, range));

        // Discard the import that we replaced with the inlined module.
        receiver.dependencies = receiver.dependencies.filter(dep => {
          return ![moduleIdDep, webpackHeaderDep].includes(dep);
        });

        deadModules.add(inlineCandidate.identifier());

      });

      compilation.chunks.forEach(chunk => {
        chunk.modules
          .filter(x => deadModules.has(x.identifier()))
          .forEach(module => chunk.removeModule(module));
      });

    });

  });
}

module.exports = LeafModuleInlinerPlugin;
