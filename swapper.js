
var scripts = document.getElementsByTagName("script");
var uris = [];
var loaded_scripts = {};

for (var i = 0; i < scripts.length; i++) {
  uris.push(scripts[i].getAttribute('src'));
}

uris = ["test.js"];

var isArray = function(o) {
    return Object.prototype.toString.call(o) === '[object Array]';
}

var parseVariableDeclsForFunctionNames = function(decls) {
    var results = [];

    for (var i = 0; i < decls.length; i++) {
        var decl = decls[i];

        if (decl.type == "VariableDeclarator" && decl.init.type == "FunctionExpression") {
            results.push(decl.id.name);
        }
    }

    return results;
};

var findFunctionDecls = function(ast) {
    var decls = [];

    if (isArray(ast)) {
        for (var i = 0; i < ast.length; i++) {
            Array.prototype.push.apply(decls, findFunctionDecls(ast[i]));
        }

        return decls;
    }

    if (ast.type === "VariableDeclaration") {
        return parseVariableDeclsForFunctionNames(ast.declarations);
    }

    if (ast.body) {
        return findFunctionDecls(ast.body);
    }

    return [];
};

var instrument = function(script) {
  var syntax = esprima.parse(script);

  console.log(JSON.stringify(syntax, null, 2));

  console.log(findFunctionDecls(syntax));
};

var scan = function() {
  for (var i = 0; i < uris.length; i++) {
    var uri = uris[i];
    var script = $.ajax({url: uri, async: false, dataType: 'text' }).responseText; // Fun fax: if you don't flag it as text, jQuery will "intelligently" assume it to be javascript and recursively eval the same file over and over until the browser crashes.

    if (!loaded_scripts[uri]) {
      loaded_scripts[uri] = script;

      instrument(script);
    } else {
      if (loaded_scripts[uri] != script) {
        console.log("reload of " + uri);

        loaded_scripts[uri] = script;
      }
    }
  }
};

setInterval(scan, 100);