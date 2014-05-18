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

  instrument():E.Program {
    var ast:E.Program = esprima.parse(this.script);

    this.instrument_ast(ast);
    return ast;
  }

  // Helper for recursive function.
  instrument_list(list:E.Node[]) {
    for (var i = 0; i < list.length; i++) {
      this.instrument_ast(list[i]);
    }
  }

  /*
   * After `instrument_ast`, the rest of the functions are all dynamically dispatched
   * from `instrument_ast` as we recursively descend the AST, based on the type of the
   * node. This is many so we can take advantage of the types without having to invent
   * new variables for each recasted variable, as we might if we had a case or long if
   * statement.
   */
  instrument_ast(ast:E.Node) {
    var dispatch_name:string = "instrument_" + ast.type;

    if (this[dispatch_name]) {
      this[dispatch_name](ast);
    } else {
      console.log("(instrument_ast) dispatch not found for ", dispatch_name);
    }
  }

    // e.g. "a"
  private instrument_Identifier(ast:E.Identifier) {
    // TODO if name is special...

    /*
    var lookup = get_lookup(ast.name);

    if (lookup) {
        ast.name = "FN_TABLE['" + lookup + "']";
    }
    */
  }

  // e.g. "7"
  private instrument_Literal(ast:E.Identifier) {
  }

  // e.g. "console.log"
  private instrument_MemberExpression(ast:E.Identifier) {

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

  private instrument_FunctionDeclaration(ast:E.FunctionDeclaration) {
    this.instrument_list(ast.body);
  }

  private instrument_VariableDeclarator(ast:E.VariableDeclarator) {
    if (ast.init.type == "FunctionExpression") {
      ast.id.name = "$" + ast.id.name;
    }
  }

  private instrument_VariableDeclaration(ast:E.VariableDeclaration) {
    this.instrument_list(ast.declarations);
  }

  private instrument_ExpressionStatement(ast:E.ExpressionStatement) {
    this.instrument_ast(ast.expression);
  }

  private instrument_AssignmentExpression(ast:E.AssignmentExpression) {
    this.instrument_list([ast.left, ast.right]);
  }

  private instrument_CallExpression(ast:E.CallExpression) {
    this.instrument_ast(ast.callee);
    this.instrument_list(ast.arguments);
  }

  private instrument_BlockStatement(ast:E.BlockStatement) {
    this.instrument_list(ast.body);
  }

  private instrument_Program(ast:E.Program) {
    this.instrument_list(ast.body);
  }

  private instrument_FunctionExpression(ast:E.FunctionExpression) {
    this.instrument_ast(ast.body);
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

        var ins:Instrumentor = new Instrumentor(script)
        console.log(escodegen.generate(ins.instrument()));

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
