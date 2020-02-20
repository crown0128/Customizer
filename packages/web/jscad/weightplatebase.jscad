



weightPlateBase = function weightPlateBase (param, ClockMode) {

include("/../fonts/opentype.min.jscad");
include("/../fonts/fontsgothicb_ttf.jscad");
include("/../weightPlate.jscad");
include("/../base.jscad");

/*
var price = 0
var size = param.sizeOpt;
if(size == 11)
  price = 61
if(size == 15)
  price = 73
if(size == 18)
  price = 105

var priceControl = document.getElementById('price')
if(priceControl !== null) {
  priceControl.value = "$" + price + ".00";
}
*/
  var size = param.sizeOpt;
  var cutObjects = []; // our stack of objects
  var unscaledCutObjects = []; // our stack of objects
  var allObjects = []; // our stack of objects
  var otherItems = [];
  var p = []; // our stack of extruded line segments

  var plateColor =   html2rgb(param.colorOpt)
  var textColor = plateColor.map((a, i) => a + .05);

  var maxTextLength = max(getTotalCharLen(param.TopText, secondLineFactor = .2), getTotalCharLen(param.BottomText, secondLineFactor = .2))
  var textSize = min(28, 5000/maxTextLength)
var textHeight = 4;


if(param.LeftText.trim() !== ''){allObjects.push(linear_extrude({height: textHeight}, straightText(param.LeftText, textSize = textSize, maxCharsPerLine = 5)).setColor(textColor).translate([-110,-7.5,0]));}
if(param.RightText.trim() !== ''){allObjects.push(linear_extrude({height: textHeight}, straightText(param.RightText, textSize = textSize, maxCharsPerLine = 5)).setColor(textColor).translate([110,-7.5,0]))}
if(param.TopText.trim() !== ''){allObjects.push(linear_extrude({height: textHeight}, revolveMultilineText(param.TopText, 85, 130, true, textSize = textSize)).setColor(textColor));}
if(param.BottomText.trim() !== ''){allObjects.push(linear_extrude({height: textHeight}, revolveMultilineText(param.BottomText, 85, 130, false, textSize = textSize)).setColor(textColor));}
if(ClockMode) {
  cutObjects.push(clockTicks().setColor(textColor));
  unscaledCutObjects.push(cylinder({r: 4, h: 30, center: true}).setColor(textColor)) 
}
else {
  cutObjects.push(cylinder({r: 21, h: 30, center: true}).setColor(textColor)) 

}
  

  var b = allObjects[0].getBounds();
  var m = 2;
  if(!param.hidePlate){
    allObjects.push(weightPlate().rotateZ(45).translate([0,-254,-1]).setColor(plateColor));
  }

  var item = union(allObjects).subtract(cutObjects).scale(size/14.7);
 
  return item.union(otherItems).subtract(unscaledCutObjects);
}



function revolveMultilineText(text, textAngle = 90, radius = 180, invert = true, textSize = 28) {
  var textArray = text.split('\n');
  if(textArray.length == 1)  {
    return revolveText(text, textAngle, radius, invert, textSize);
  }
  var allText = [];
  var lineRadius = radius + (textArray.length - 1)/2*textSize -10
  textArray.forEach((word) => {
    allText.push(revolveText(word, textAngle, lineRadius, invert, textSize));
    lineRadius -= textSize
  });
  return union(allText)
}


function revolveText(text, textAngle = 90, radius = 130, invert = true, textSize = 28)
{
  var invertVal = invert?1:-1
  var totalCharLen = getTotalCharLen(text, textSize);
  var word = [];
  var iRadius = radius-invertVal*10 + (28-textSize)/2;


  spanAngle = min(textAngle, getTextWidth(text, textSize) /2 * 130/radius);
  
  var charLen = 0;
  for (var x = 0; x < text.length; x++)
  {

    var c = text.charAt(x);
    var charWidth = getCharWidth(c, textSize);
    charLen += charWidth;
        if(c.trim() !== ''){
    word.push(getText(c,textSize).translate([-getCharWidth(c, textSize)/2,invertVal*iRadius,0]).rotateZ(-invertVal*( (charLen- charWidth/2)/totalCharLen*spanAngle) +invertVal*(spanAngle/2)));
    }
  }
return union(word);
}

function clockTicks() {
  var ticks = []
  var size = 4;
  var width = 3;
  var multiplierForMajor = 2;
 for (var i = 0; i < 60; i++)
  {
    var tick = null
    if(i%15 == 0) {         
      tick = cube({size: [width,size*multiplierForMajor,15], center: true});
    } 
    else if(i%5 == 0) {  
      tick = cube({size: [width,size,15], center: true});
    }
    else {
      //tick = cube({size: [width/2,size/2,15], center: true});
    }
    if(tick !== null)
    ticks.push(tick.translate([0,172,12]).rotateZ(i*(360/60)));
  }
  return union(ticks)
}





    
