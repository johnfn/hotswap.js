var f = function() {
    console.log("normal");

    //console.log("fff");
};

var g = function() { console.log("dfg"); }; 

// Needs to be wrapped because otherwise it'd store a stale reference.
setInterval(function() { FN_TABLE['FN_0'](); } , 1000);