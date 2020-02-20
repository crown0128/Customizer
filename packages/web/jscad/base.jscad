allItemBase = function allItemBase (param, item) {

    include("/../banana.jscad");
    
    if(param.bananaInternal !== null && param.bananaInternal) {
        return item.union(banana());
      }
      return item
}

logMsg = function log(msg) {

    var debugControl = document.getElementById('debug') 
    if(debugControl !== null)
      debugControl.innerHTML += '<br>' + msg;
    }
    
straightText = function straightText(text, textSize = 20, maxCharsPerLine = 20, maxlines = 3)
    {
        include("/../fonts/opentype.min.jscad");
        include("/../fonts/fontsgothicb_ttf.jscad");

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

getText = function getText(text, textSize){
        var gothic = Font3D.parse(fontsgothicb_ttf_data.buffer);
        var cagText = Font3D.cagFromString(gothic, text, textSize);
        return union(cagText, textSize);
      
      }

getTextWidth = function getTextWidth(c, textSize = 28) {
    return getTextWidthBase(c, textSize, includeSpace = false)
    }
getCharWidth = function getCharWidth(c, textSize = 28) {
    return getTextWidthBase(c, textSize, includeSpace = true)
    }

getTotalCharLen = function getTotalCharLen(text, textSize, secondLineFactor = 0)
{
    include("/../fonts/opentype.min.jscad");
    include("/../fonts/fontsgothicb_ttf.jscad");
    
  var totalCharLens = [];
  var lineNum = 0
  text.split('\n').forEach((line) => {
      var totalCharLen = 0
      for (var x = 0; x < line.length; x++)
      {
        var c = line.charAt(x);
        totalCharLen += getCharWidth(c, textSize);
      }
      totalCharLens.push(totalCharLen * (1 + secondLineFactor * lineNum))
     // console.log('total len of ' + line + ':' + totalCharLen)
      lineNum++;
    })
  //  console.log('max len of ' + text + ':' + Math.max(...totalCharLens))
  return Math.max(...totalCharLens);

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

      