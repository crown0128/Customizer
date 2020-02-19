



weightPlateBase = function weightPlateBase (param, ClockMode) {

include("/../fonts/opentype.min.jscad");
include("/../fonts/fontsgothicb_ttf.jscad");
include("/../weightPlate.jscad");
/*
var price = 0
var size = param.sizeInternal;
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
  var size = param.sizeInternal;
  var cutObjects = []; // our stack of objects
  var unscaledCutObjects = []; // our stack of objects
  var allObjects = []; // our stack of objects
  var otherItems = [];
  var p = []; // our stack of extruded line segments

  var plateColor =   html2rgb(param.colorInternal)
  var textColor = plateColor.map((a, i) => a + .05);

  var maxTextLength = max(getTotalCharLen(param.TopText), getTotalCharLen(param.BottomText))
  var textSize = min(28, 5000/maxTextLength)
var textHeight = 4;


if(param.LeftText.trim() !== ''){allObjects.push(linear_extrude({height: textHeight}, straightText(param.LeftText, textSize = textSize)).setColor(textColor).translate([-110,-7.5,0]));}
if(param.RightText.trim() !== ''){allObjects.push(linear_extrude({height: textHeight}, straightText(param.RightText, textSize = textSize)).setColor(textColor).translate([110,-7.5,0]))}
if(param.TopText.trim() !== ''){allObjects.push(linear_extrude({height: textHeight}, revolveText(param.TopText, 85, 130, true, textSize = textSize)).setColor(textColor));}
if(param.BottomText.trim() !== ''){allObjects.push(linear_extrude({height: textHeight}, revolveText(param.BottomText, 85, 130, false, textSize = textSize)).setColor(textColor));}
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

function straightText(text, textSize = 20, maxlines = 3, maxCharsPerLine = 7)
{
  var vSpacing = textSize * 1.5
  var textArray = text.split('\n').slice(0,maxlines)
  var allText = [];

  var zh = vSpacing/2 * (max(0,textArray.length - 1));
  textArray.forEach((word) => {
    if(word.trim() !== ''){
      word = word.substr(0,maxCharsPerLine);
     let extrudedText = getText(word, textSize).translate([-getTextWidth(word, textSize)/2,zh,0]);

      zh-=vSpacing;
      allText.push(extrudedText)
  }
  });
  return union(allText);
} 
/*
function revolveMultilineText(text, textAngle = 90, radius = 180, invert = true, textSize = 28)
{
  var textArray = text.split('\n').slice(0,maxlines)
  var allText = [];
  var lineRadius = radius - (textArray - 1)/2*30
  textArray.forEach((word) => {
    revolveText(text, textAngle, radius, invert, textSize)
  }
}

*/
function revolveText(text, textAngle = 90, radius = 180, invert = true, textSize = 28)
{
  var invertVal = invert?1:-1
  var totalCharLen = getTotalCharLen(text, textSize);
  var word = [];
  var iRadius = radius-invertVal*10 + (28-textSize)/2;


  spanAngle = min(textAngle, getTextWidth(text, textSize) /2);
  
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

function getText(text, textSize){
  var gothic = Font3D.parse(fontsgothicb_ttf_data.buffer);
  var cagText = Font3D.cagFromString(gothic, text, textSize);
  return union(cagText, textSize);

}


function getTotalCharLen(text, textSize)
{
  var totalCharLen = 0;
  for (var x = 0; x < text.length; x++)
  {
    var c = text.charAt(x);
    totalCharLen += getCharWidth(c, textSize);
  }
  return totalCharLen;

}

function getTextWidth(c, textSize = 28) {
  return getTextWidthBase(c, textSize, includeSpace = false)
}
function getCharWidth(c, textSize = 28) {
  return getTextWidthBase(c, textSize, includeSpace = true)
}
function getTextWidthBase(c, textSize = 28, includeSpace) {
   if(c.trim() !== '')
   {
    var character = getText(c,1).toPoints();
    console.log(character);
    var minVal = character.reduce((minVal, p) => p.x < minVal ? p.x : minVal, character[0].x)
    var maxVal = character.reduce((maxVal, p) => p.x > maxVal ? p.x : maxVal, character[0].x);
    var letterWidth = maxVal-minVal
    if(includeSpace)
        return pow(letterWidth, .6) *textSize;
    else
        return letterWidth*textSize;
  }
  else
  {
    return 15;
  }

}


    
