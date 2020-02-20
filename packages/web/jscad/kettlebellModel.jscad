

function getParameterDefinitions () {
  return [
    {name: 'Configuration', type: 'group', caption: 'Design Options'},
    {name: 'TopText', initial: 'Line 1\nLine 2\nLine 3', type: 'textbox', caption: 'Text', height: '5'},
    {name: 'colorOpt',
    type: 'choice',
    caption: 'Color',
    values: ['#1c1c1c', '#dedede'],
    captions: ['Black', 'Gray'],
    },


    //{name: 'hidePlate', checked: false, type: 'checkbox', caption: 'Hide Plate'},
   
    {name: 'sizeOpt',
    type: 'choice',
    caption: 'Height',
    values: ['6', '8'],
    captions: ['6"', '8"'],
    initial: '6', internal: true
  },

    {name: 'bananaInternal', checked: false, type: 'checkbox', caption: 'Banana for Scale', internal: true},
    //{name: 'color', type: 'color', initial: '#0F0F0F', caption: 'Color?'}
  ];
}


function main (param) {
  include("/../kettlebell.jscad");
  include("/../base.jscad");

  var maxTextLength = getTotalCharLen(param.TopText);
  var textSize = min(10, 1500/maxTextLength)
  var textItems = []

  var item = kettlebell().setColor(html2rgb(param.colorOpt))
  var textVector = straightText(param.TopText, textSize)
  textItems.push(linear_extrude({height: 5}, textVector).translate([0,0,33]).setColor([1,1,1]));
  textItems.push(linear_extrude({height: 5}, textVector).translate([0,0,33]).rotateY(180).setColor([1,1,1]));
  item = item.union(textItems).scale(param.sizeOpt/6)
  item = allItemBase(param, item);
    
  return item;
}


