/// <reference path="typings/esprima/esprima.d.ts" />
/// <reference path="typings/jquery/jquery.d.ts" />

declare var module;
declare var escodegen;

import E = esprima.Syntax;
/*
Why doesn't this work? :/

declare var escodegen {
  function generate(ast:esprima.Syntax.Program);
};
*/

// Eventually this will be a more complicated namespacing thing.
// But for now...
class FunctionFinder {

  /*
  find_all_functions(ast:esprima.Syntax.Node) {
      function recurse_on_array(ast:esprima.Syntax.Node[]) {
          var result = [];

          for (var i = 0; i < ast.length; i++) {
              var functions = this.find_all_functions(ast[i]);

              result.push.apply(result, functions);
          }

          return result;
      };

      switch (ast.type) {
          case "Literal": case "Identifier":
              return [];
          case "ReturnStatement":
              return this.find_all_functions(ast.argument);
          case "Program":
              return recurse_on_array(ast.body);
          case "CallExpression":
              return recurse_on_array(ast.arguments);
          case "ExpressionStatement":
              return find_all_functions(ast.expression);
          case "AssignmentExpression":
              return recurse_on_array([ast.left, ast.right]);
          case "VariableDeclaration":
              return recurse_on_array(ast.declarations);
          case "EmptyStatement":
              return [];
          case "FunctionExpression":
              return find_all_functions(ast.body);
          case "BlockStatement":
              return recurse_on_array(ast.body);
          case "FunctionDeclaration":
              var functions = find_all_functions(ast.body);
              functions.push(ast.id.name);
              return functions;
          case "VariableDeclarator":
              if (ast.init.type == "FunctionExpression") {
                  var functions = find_all_functions(ast.init);
                  functions.push(ast.id.name);
                  return functions;
              } else {
                  return [];
              }
          default:
              console.log("dont recognize ", ast.type);
              return [];
      }
  }
  */

}

/*
 * Given a normal JS file passed in as a string:
 *
 * 1. Give every function a unique id.
 * 2. Store each function in a table by that unique id.
 * 3. Rewrite lookups to use the table and the unique id.
 *
 * This means we can hotswap in new function definitions later
 * simply by updating the table.
 */
class Instrumentor {
  script: string;

  constructor(script:string) {
    this.script = script;
  }

  instrument() {
    this.instrument_ast(esprima.parse(this.script), {});
  }

  // Helper for recursive function.
  instrument_list(list:E.Node[], fns:{[key:string]: string}) {
    for (var i = 0; i < list.length; i++) {
      this.instrument_ast(list[i], fns);
    }
  }

  instrument_Identifier(ast:E.Identifier) {
    // e.g. "a"

    // TODO if name is special...

    /*
    var lookup = get_lookup(ast.name);

    if (lookup) {
        ast.name = "FN_TABLE['" + lookup + "']";
    }
    */
  }

  instrument_Literal(ast:E.Identifier) {
    // e.g. "7"
  }

  instrument_MemberExpression(ast:E.Identifier) {
    // e.g. "console.log"

    // TODO:
    //
    // Maybe what would be best would be to do something like var a = function(){}; gets rewritten to also have a.id = genUID() after it (comma operator brah)
    // More precisely, (var a = function(){}, a.id=genUID(), FN_TABLE[a.id] = a, a); (as to correctly return the function)
    // Then lookups would be like this: a() turns into FN_TABLE[a.id]() and herp.derp just becomes FN_TABLE[herp.derp.id]().
    //
    // The only thing left is to wrap the lookup in an anonymous function so it doesn't become "cached" in cases like setTimeout. e.g.
    //
    // setTimeout(a) becomes setTimeout(function(){ return FN_TABLE[a.id]; })
    //
    // This is only necessary when passing around uncalled functions.

    // That would work, I think. (Famous last words.)
  }

  instrument_ExpressionStatement(ast:E.ExpressionStatement) {
    this.instrument_ast(ast.expression);
  }

  instrument_ast(ast:E.Node) {
    var dispatch_name:string = "instrument_" + ast.type;

    if (this[dispatch_name]) {
      this[dispatch_name]();
    } else {
      console.log("(instrument_ast) dispatch not found for ", dispatch_name);
    }

    switch (ast.type) {
        case "VariableDeclaration": case "FunctionDeclaration": break;

        case "ExpressionStatement":
            var e = <E.ExpressionStatement>ast;
            this.instrument_ast(e, fns);

            break;
        case "AssignmentExpression":
            var a = <E.AssignmentExpression>ast;
            this.instrument_list([a.left, a.right], fns);

            break;
        case "CallExpression":
            this.instrument_ast(ast.callee, fns);
            this.instrument_list(ast.arguments, fns);
            break;
        case "BlockStatement":
            this.instrument_list(ast.body, fns);
            break;
        case "Program":
            this.instrument_list(ast.body, fns);
            break;
        case "FunctionExpression":
            this.instrument_ast(ast.body, fns);
            break;
        default:
            console.log("(instrument_ast) dont recognize ", ast.type);

            debugger;
            break;
    }
  }
}

/*
 * Scan script files for updates.
 */
class Scanner {
  scripts: string[] = [];
  loaded_scripts: {[key: string]: string} = {};

  constructor() {
    setInterval(() => this.scan(), 100);
  }

  hotswap(script:string) {
    this.scripts.push(script);
  }

  reload(new_script:string, old_script:string, file_name:string) {
    console.log("reload of " + file_name);

    var i:Instrumentor = new Instrumentor(new_script);

    console.log((<any>escodegen).generate(i.instrument()))

    // Attempt to find the location at which they differ, then walk the AST and find the corresponding node and mark it.
    // Then, find the enclosing function, rewrite it and reload it into the FN_TABLE.

    // A slightly better way to do this would be to directly diff the ASTs...

    /*
    var line_column = get_change_location(new_script, old_script);

    var ast = esprima.parse(new_script, {loc: true});

    var changed_function_ast = find_changed_function(ast, line_column[0], line_column[1]);

    var fn_body = escodegen.generate(changed_function_ast.declarations[0].init);
    var fn_name = changed_function_ast.declarations[0].id.name;
    var table_name = function_tables[file_name][fn_name];
    var instrumented_fn = instrument("___x = " + fn_body);// "___x = " is a hack to make it return the value. function declarations dont generally return anything.

    FN_TABLE[table_name] = eval(instrumented_fn);
    */

    //need to rewrite to use FN_TABLE via instrument()
  }

  scan() {
    for (var i = 0; i < this.scripts.length; i++) {
      var script_name = this.scripts[i];
      var script = $.ajax({url: script_name, async: false, dataType: 'text', cache: false }).responseText; // Fun fax: if you don't flag it as text, jQuery will "intelligently" assume it to be javascript and recursively eval the same file over and over until the browser crashes.

      if (!this.loaded_scripts[script_name]) {
        this.loaded_scripts[script_name] = script;

        // TODO enable the following once it's working.
        // $.globalEval(instrument(script, script_name, true));
      } else {
        if (this.loaded_scripts[script_name] != script) {
          var old_script = this.loaded_scripts[script_name];

          this.loaded_scripts[script_name] = script;

          this.reload(script, old_script, script_name);
        }
      }
    }
  }
}
if (typeof module === 'undefined') {
  var scanner:Scanner = new Scanner();

  window['hotswap'] = scanner.hotswap.bind(scanner);
}
