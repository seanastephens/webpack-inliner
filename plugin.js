const ConstDependency = require('webpack/lib/dependencies/ConstDependency');

function HelloWorldPlugin(options) {

}

HelloWorldPlugin.prototype.apply = function(compiler) {

  compiler.plugin('compilation', compilation => {
    const discardModules = new Set();
    const replacements = new Map();

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
        if(requirers.length !== 1) {
          return console.log('Not inlining', module.rawRequest, 'into', requirers[0].rawRequest, ': too many requirers');
        }

        if(module.dependencies.length > 0) {
          return console.log('Not inlining', module.rawRequest, 'into', requirers[0].rawRequest, ': has dependencies');
        }

        console.log('Inlining', module.rawRequest, 'into', requirers[0].rawRequest);

        const m = compilation.getModule(requirers[0]);
        const uid = 'exports';

        const requireDeps = m.dependencies
          .filter(dep => dep.request === module.rawRequest);

        const requireDepStarts = requireDeps.map(dep => dep.range[0]);

        const headerDeps = m.dependencies
          .filter(dep => requireDepStarts.includes(dep.range[1] + 1));

        const ranges = requireDeps
          .map(dep => {
            const startOfEnd = dep.range[0];
            const end = dep.range[1];
            const matchingDep = headerDeps.filter(dep => dep.range[1] === startOfEnd - 1)[0];
            const start = matchingDep.range[0];
            return [start, end + 1];
          });

        const iMod = compilation.getModule(module);

        const iModText = compilation.getModule(module)._source.source().replace(/['"]use strict['"];/g, '');

        const inlineText = `(function() {\nvar ${uid} = {};\n` + iModText.replace('module.exports', uid) + `\nreturn ${uid};\n})()`

        ranges.forEach(range => {
          m.addDependency(new ConstDependency(inlineText, range));
        })

        m.dependencies = m.dependencies.filter(dep => {
          return !requireDeps.includes(dep) && !headerDeps.includes(dep);
        });

        discardModules.add(module.identifier());
      });

      const shouldKeep = x => !discardModules.has(x.identifier());

      compilation.chunks.forEach(chunk => {
        chunk.modules = chunk.modules.filter(shouldKeep);
      });

    });

  });
}

module.exports = HelloWorldPlugin;
