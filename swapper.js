esprima = require('esprima');
escodegen = require('escodegen');

var scripts ;
var uris = [];
var loaded_scripts = {};
var function_name_to_lookup = {};

uris = ["test.js"];

function assert(condition, message) {
    if (!condition) {
        throw message || "Assertion failed";
    }
}

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

var get_lookup = function(name) { // TODO needs a rename
    return function_name_to_lookup[name];
}

var uid=0;
var put_lookup = function(name) {
    if (! (name in function_name_to_lookup)) {
        function_name_to_lookup[name] = "FN_" + uid;
        ++uid;
    } else {
        console.log("function " + name + " previously defined. I not smart enough to deal with this case yet.");
    }

    return function_name_to_lookup[name];
}

function dbgast(ast) {
    console.log(JSON.stringify(ast, null, 2));
}

/*
 The task of instrument_ast is to replace all references to functions within AST with references to our table of functions instead. 
 This allows us to hotswap in a new function later if required.

 It's a destructive modification of the ast; it doesn't return anything.
 */
var instrument_ast = function(ast) {
    var decls = [];

    if (ast.type == "Identifier") {
        var lookup = get_lookup(ast.name);

        if (lookup) {
            ast.name = "FN_TABLE['" + lookup + "']";
        }

        return;
    }

    if (ast.type == "ExpressionStatement") {
        instrument_ast(ast.expression);

        return;
    }

    if (ast.type == "AssignmentExpression") {
        instrument_ast(ast.left);
        instrument_ast(ast.right);
    }

    if (ast.type == "CallExpression") {
      instrument_ast(ast.callee);
      
      if (ast.arguments) {
          for (var i = 0; i < ast.arguments.length; i++) {
              instrument_ast(ast.arguments[i]);
          }
      }
    }


    if (ast.type === "VariableDeclaration") {
        var fn_names = parse_variable_decls_for_function_names(ast.declarations);

        if (fn_names.length > 1)  {
            console.log("wat, i can't do multiple definitions in the same declaration block... go away.");
        }

        var fn_name = fn_names[0];
        instrument_ast(ast.declarations[0].init);
        var rightside = escodegen.generate(ast.declarations[0].init);
        var leftside = "FN_TABLE['" + put_lookup(fn_name) + "']";

        var gen = esprima.parse(leftside + "=" + rightside);

        for (var key in ast) delete ast[key];
        for (var key in gen.body[0]) ast[key] = gen.body[0][key];

        return;
    }

    if (ast.type == "Program") {
        if (ast.body) {
            for (var i = 0; i < ast.body.length; i++) {
                instrument_ast(ast.body[i]);
            }
        }
    }

    if (ast.type == "FunctionExpression") {
        if (ast.body && ast.body.body) {
            for (var i = 0; i < ast.body.body.length; i++) {
                instrument_ast(ast.body.body[i]);
            }
        }
    }

};

var instrument = function(script, first_time) {
  if (!first_time) first_time = false;

  var syntax = esprima.parse(script);

  instrument_ast(syntax);

  var instrumented_file = (first_time ? "var FN_TABLE = {};\n" : "") + escodegen.generate(syntax);

  return instrumented_file;
};

var get_change_location = function(new_script, old_script) {
    // Find line and column differences.

    var new_lines = new_script.split("\n");
    var old_lines = old_script.split("\n");
    var line = -1;
    var column = -1;

    for (line = 0; line < Math.min(new_lines.length, old_lines.length); line++) {
        if (new_lines[line] != old_lines[line]) {
            break;
        }
    }

    var new_line = new_lines[line];
    var old_line = old_lines[line];

    ++line; // lines are 1-indexed.

    for (column = 0; column < Math.min(new_line.length, old_line.length); column++) {
        if (new_line[column] != old_line[column]) {
            break;
        }
    }

    return [line, column];
}

// returned changed fn.
var find_changed_function = function(ast, line, col) {
    assert(line != undefined); assert(col != undefined);

    var loc = ast.loc;
    var good = (loc.start.line <= line && loc.end.line >= line);
    if (line == loc.start.line && loc == loc.end.line) {
        good == good && (loc.start.col <= col && loc.end.col >= col)
    }

    if (!good) return;

    if (ast.declarations && ast.declarations.length > 1) {
        console.log("holy crap multiple declarations time to die"); //TODO
    }

    if (ast.type == "VariableDeclaration" && ast.declarations[0].init.type == "FunctionExpression") {
        return ast;
    }

    if (ast.body) {
        for (var i = 0; i < ast.body.length; i++) {
            var result = find_changed_function(ast.body[i], line, col);

            if (result) return result;
        }
    }

    if (ast.arguments) {
        for (var i = 0; i < ast.arguments.length; i++) {
            var result = find_changed_function(ast.arguments[i], line, col);

            if (result) return result;
        }
    }

    console.log("fail to parse:: ", ast);
    return;
}

var reload = function(new_script, old_script) {
    // Attempt to find the location at which they differ, then walk the AST and find the corresponding node and mark it.
    // Then, find the enclosing function, rewrite it and reload it into the FN_TABLE.

    // A slightly better way to do this would be to directly diff the ASTs...

    var line_column = get_change_location(new_script, old_script);

    var ast = esprima.parse(new_script, {loc: true});

    var changed_function_ast = find_changed_function(ast, line_column[0], line_column[1]);

    var fn_body = escodegen.generate(changed_function_ast.declarations[0].init);
    var fn_name = changed_function_ast.declarations[0].id.name;
    var table_name = get_lookup(fn_name);
    var instrumented_fn = instrument("___x = " + fn_body);// "___x = " is a hack to make it return the value. function declarations dont generally return anything. 

    FN_TABLE[table_name] = eval(instrumented_fn); 

    //need to rewrite to use FN_TABLE via instrument()
};

var scan = function() {
  for (var i = 0; i < uris.length; i++) {
    var uri = uris[i];
    var script = $.ajax({url: uri, async: false, dataType: 'text', cache: false }).responseText; // Fun fax: if you don't flag it as text, jQuery will "intelligently" assume it to be javascript and recursively eval the same file over and over until the browser crashes.

    if (!loaded_scripts[uri]) {
      loaded_scripts[uri] = script;

      $.globalEval(instrument(script, true));
    } else {
      if (loaded_scripts[uri] != script) {
        console.log("reload of " + uri);

        var old_script = loaded_scripts[uri];

        loaded_scripts[uri] = script;

        reload(script, old_script);
      }
    }
  }
};

var hotswap = function(script) {
    uris.push(script);
};

if (module) {
    module.exports.instrument = instrument;
    module.exports.__clear_table = function() { function_name_to_lookup = {}; };
} else {
    scripts = document.getElementsByTagName("script");
    setInterval(scan, 100);
}
