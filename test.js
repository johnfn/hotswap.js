var g = function() { console.log("dfg"); }; 

var f = function() {
    console.log("normal");

    console.log("fff");

    //g();
};

// Needs to be wrapped because otherwise it'd store a stale reference.
setInterval(function() { f(); } , 1000);