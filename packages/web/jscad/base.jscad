allItemBase = function allItemBase (param, item) {

    include("/../banana.jscad");
    if(param.bananaInternal) {
        return item.union(banana().rotateZ(45).translate([-190,190,0]).setColor([1,.882,.208]));
      }
      return item
}

logMsg = function log(msg) {

    var debugControl = document.getElementById('debug') 
    if(debugControl !== null)
      debugControl.innerHTML += '<br>' + msg;
    }
    
    