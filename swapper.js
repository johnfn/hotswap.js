
var scripts = document.getElementsByTagName("script");
var uris = [];
var loaded_scripts = {};
var function_name_to_lookup = {};

for (var i = 0; i < scripts.length; i++) {
  uris.push(scripts[i].getAttribute('src'));
}

uris = ["test.js"];

var is_array = function(o) {
    return Object.prototype.toString.call(o) === '[object Array]';
}

var parse_variable_decls_for_function_names = function(decls) {
    var results = [];

    for (var i = 0; i < decls.length; i++) {
        var decl = decls[i];

        if (decl.type == "VariableDeclarator" && decl.init.type == "FunctionExpression") {
            results.push(decl.id.name);
        }
    }

    return results;
};

var uid=0;
var get_lookup = function(name) {
    if (! (name in function_name_to_lookup)) {
        function_name_to_lookup[name] = "FN_" + uid;
        ++uid;
    }

    return function_name_to_lookup[name];
}

var instrument_ast = function(ast) {
    var decls = [];

    if (ast.type === "VariableDeclaration") {
        var fn_names = parse_variable_decls_for_function_names(ast.declarations);

        if (fn_names.length > 1)  {
            console.err("wat, i can't do multiple definitions in the same declaration block... go away.");
        }

        var fn_name = fn_names[0];
        var rightside = escodegen.generate(ast.declarations[0].init);
        var leftside = "FN_TABLE[" + get_lookup(fn_name) + "]";

        var gen = esprima.parse(leftside + "=" + rightside);

        for (var key in ast) delete ast[key];
        for (var key in gen.body[0]) ast[key] = gen.body[0][key];

        return;
    }

    if (ast.body) {
        for (var i = 0; i < ast.body.length; i++) {
            instrument_ast(ast.body[i]);
        }
    }
};

var instrument = function(script) {
  var syntax = esprima.parse(script);

  instrument_ast(syntax);
  console.log(escodegen.generate(syntax));
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