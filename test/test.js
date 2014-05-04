var should = require('should');
var esprima = require('esprima');
var escodegen = require('escodegen');
var swapper = require('../swapper.js');

describe('Herpin', function() {
    var FN_TABLE = {};

    function run(js) {
        var _return;
        var instrumented;

        try {
            instrumented = swapper.instrument(js);
            eval(instrumented);
        } catch (e) {
            console.log("failure to evaluate the following code: \n" + instrumented);
            console.log("err looks like this, good luck: " + e);
        }

        return _return;
    }

    afterEach(function() {
        FN_TABLE = {};
    })

    it("should be sane", function() {
        run('_return = 2;').should.equal(2);
    });

    it("should fill out the FN_TABLE correctly", function() {
        run("var f = function() { return 1; }; var g = function() { return 2; }");
        FN_TABLE['FN_0']().should.equal(1);
        FN_TABLE['FN_1']().should.equal(2);
    })

    it("should replace function calls correctly", function() {
      run("var f = function() { return 1; }; _return = f();").should.equal(1);
    });

    it.skip("doesn't need to see a var keyword", function() {
      run("f = function() { return 1; }; _return = f();").should.equal(1);
    });

    it.skip("bare function references should be rewritten into anonymous functions", function() {
        // how to even prove. lolz.
    })

    // test diff-finding
});
