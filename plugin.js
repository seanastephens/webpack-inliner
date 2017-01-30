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

function HelloWorldPlugin(options) {

}

HelloWorldPlugin.prototype.apply = function(compiler) {

  compiler.plugin('compilation', compilation => {
    const deadModules = new Set();

    compilation.plugin('optimize-modules', modules => {
      const refMap = new Map();
      modules.forEach(sourceModule => {
        sourceModule.dependencies.forEach(({ module }) => {
          if(module !== null) {
            const refs = refMap.get(module) || [];
            refs.push(sourceModule);
            refMap.set(module, refs);
          }
        });
      });

      refMap.forEach((requirers, module) => {

	const bail = makeLogger(requirers, module);

        if(requirers.length > 1) {
          return bail(`Imported ${requirers.length} > 1 times.`);
        }

        if(module.dependencies.length > 0) {
	  const estimate = module.dependencies.length / 2;
          return bail(`It has dependencies (estimated ${estimate}).`);
        }

        const inlineCandidate = compilation.getModule(module);
        const receiver = compilation.getModule(requirers[0]);

	if(!inlineCandidate._source) {
		return bail('Can\'t find source of inline candidate.');
	}

	const byPosition = (a, b) => a.range[0] - b.range[0];
	const sortedDeps = receiver.dependencies.slice().sort(byPosition);
	const pairs = sortedDeps
		.map((x, i) => [x, i])
		.filter(x => x[0].type === 'cjs require')
		.map(x => ({ 
			moduleIdDep: x[0],
			webpackHeaderDep: sortedDeps[x[1]-1]
		}))
		.filter(dep => dep.moduleIdDep.request === inlineCandidate.rawRequest);

	if(pairs.length !== 1) {
		// Being extra conservative here: If the import happens twice,
		// we can't inline because that would duplicate module
		// state/side effects. If it happens zero times, well,
		// something else is wrong.
		return bail([
			'Receiver candidate imported the inline candidate',
			`${pairs.length} times, needs to be one.`
		].join(' '));
	}

	const pair = pairs[0];

	const pairIsAdjacent = pair.webpackHeaderDep.range[1] === pair.moduleIdDep.range[0] - 1;

	if(!pairIsAdjacent) {
		return bail(`Sanity check failed: pairIsAdjacent=${pairIsAdjacent}`);
	}

        console.log('Inlining', module.rawRequest, 'into', requirers[0].rawRequest);

	const range = [pair.webpackHeaderDep.range[0], pair.moduleIdDep.range[1] + 1];

	// We need to insert a statement after 'use strict';
        const insert = inlineCandidate._source.source()
		.replace(/['"]use strict['"];/g, '')
		.replace('module.exports', 'exports');

        const inlineModuleDefinition = [
		'(function() {',
		'"use strict";',
		'var exports = {};',
		insert,
		'return exports;',
		'})()'
	].join('\n');

	receiver.addDependency(new ConstDependency(inlineModuleDefinition, range));

        receiver.dependencies = receiver.dependencies.filter(dep => {
          return dep != pair.moduleIdDep && dep != pair.webpackHeaderDep;
        });

        deadModules.add(inlineCandidate.identifier());

      });

      const shouldKeep = x => !deadModules.has(x.identifier());
      compilation.chunks.forEach(chunk => {
        chunk.modules = chunk.modules.filter(shouldKeep);
      });

    });

  });
}

module.exports = HelloWorldPlugin;
