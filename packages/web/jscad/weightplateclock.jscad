

function getParameterDefinitions () {
  return [
    {name: 'Configuration', type: 'group', caption: 'Design Options'},
    {name: 'TopText', initial: 'BARBELL', type: 'textbox', caption: 'Top Text', maxLength: 14},
    {name: 'BottomText', initial: 'STANDARD', type: 'textbox', caption: 'Bottom Text', maxLength: 14},
    {name: 'LeftText', initial: '45\nLBS', type: 'textbox', caption: 'Left Text'},
    {name: 'RightText', initial: '20.4\nKGS', type: 'textbox', caption: 'Right Text'},
    {name: 'colorOpt',
    type: 'choice',
    caption: 'Color',
    values: ['#dedede', '#1c1c1c'],
    captions: ['Gray', 'Black'],
    initial: '15'
    },
    {name: 'sizeOpt',
    type: 'choice',
    caption: 'Clock Diameter',
    values: ['11', '15', '18'],
    captions: ['11"', '15"', '18"'],
    initial: '15',
    internal: true
  },
    //{name: 'hidePlate', checked: false, type: 'checkbox', caption: 'Hide Plate'},
    {name: 'displayOptions', type: 'group', caption: 'Render Options'},   
    {name: 'showKitInternal', checked: true, type: 'checkbox', caption: 'Show Clock Hands', internalDefault: false},
    {name: 'bananaInternal', checked: false, type: 'checkbox', caption: 'Banana for Scale', internal: true},
    //{name: 'color', type: 'color', initial: '#0F0F0F', caption: 'Color?'}
  ];
}


function main (param) {
  include("./weightplatebase.jscad");
  include("/../clockKit.jscad");
  include("/../base.jscad");

  var item = weightPlateBase(param, ClockMode = true);
  if(param.showKitInternal) {
    item = item.union(clockAssm(param.sizeOpt, param.colorOpt == '#1c1c1c').translate([-102,-47,-81])); }
  item = allItemBase(param, item);
  return item;
}
