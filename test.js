var g = function() { console.log("dfg"); }; 

var f = function() {
    console.log("fff");

    console.log("zzz");

    //g();
};

function d() {
    console.log("Aa");
}

// Needs to be wrapped because otherwise it'd store a stale reference.
setInterval(function() { f(); } , 1000);