// Local name analysis: proposals are editable, not authoritative classifications.
const clean=value=>String(value??'').trim().replace(/\s+/g,' ');
const norm=value=>clean(value).toLowerCase().replaceAll('ё','е').replace(/[‐‑–—]/g,'-');
export const groupKey=norm;
const title=value=>value.charAt(0).toUpperCase()+value.slice(1);
const families=[
  ['Чехол конверт',/чехол[\s-]+конверт/u],
  ['Защитный чехол',/защитный\s+чехол/u],
  ['Защитная плёнка',/(?:защитная\s+)?пленка/u],
  ['Защитное стекло',/(?:защитное\s+)?стекл[оа]/u],
  ['Чехол',/чехол/u],
  ['Кабель',/(?:кабел[ьи]|провод[а]?|cables?)/u],
  ['Зарядное устройство',/(?:зарядное устройство|зарядка|сетевой адаптер|charger)/u],
  ['Аккумулятор',/(?:(?:внешний\s+)?аккумулятор[ы]?|power\s*bank|повербанк)/u]
].map(([name,re])=>[name,new RegExp(`(?:^|\\s|[,(])(${re.source})(?=\\s|$|[,:;(])`,'u')]);
const stopWords=new Set(['для','на','с','со','из','и','в','for','with','of']);
const devices=/^(?:iphone|ipad|ipod|macbook|airpods|samsung|galaxy|xiaomi|redmi|huawei|honor|watch|apple|air|pro|max|mini|plus|ultra|se)$/i;
const variant=/^(?:black|white|blue|red|green|pink|brown|grey|gray|silver|gold|purple|orange|yellow|clear|transparent|черн\S*|бел\S*|син\S*|красн\S*|зелен\S*|розов\S*|серый|серебр\S*|золот\S*|коричнев\S*|прозрачн\S*)$/iu;
function family(name){
  const value=norm(name);
  for(const [label,re] of families){const match=value.match(re);if(match)return {name:label,known:true,match:match[1]};}
  // Unknown merchandise gets a name-derived heading instead of a fixed Other bucket.
  const words=clean(name).split(' '),prefix=[];
  for(const word of words){
    if(stopWords.has(norm(word))||devices.test(word)||/\d/.test(word)||!/^\p{L}[\p{L}-]*$/u.test(word))break;
    if(prefix.length&&/[а-я]/iu.test(prefix[0])&&/[a-z]/i.test(word))break;
    prefix.push(word);if(prefix.length===3)break;
  }
  return {name:title(norm(prefix.join(' ')||words[0]||'Без группы')).slice(0,80),known:false,match:''};
}
export const productType=name=>family(name).name;
const features=[
  ['Антишпион',/(?:антишпион|anti[ -]?spy|privacy)/iu],
  ['Матовое',/(?:матов|matte)/iu],
  ['Глянцевое',/(?:глянцев|glossy)/iu],
  ['Керамическое',/(?:керамич|ceramic)/iu],
  ['Гидрогелевое',/(?:гидрогел|hydrogel)/iu],
  ['Прозрачное',/(?:прозрачн|transparent|\bclear\b)/iu]
];
function series(name,info){
  const text=norm(name),labels=[];
  if(/стекло|плёнка/.test(info.name))for(const [label,re] of features)if(re.test(text))labels.push(label);
  // Explicit Series/Серия labels and alphanumeric model codes are strong evidence.
  const explicit=clean(name).match(/серия\s+([\p{L}\d-]+)/iu)
    ||clean(name).match(/([a-z][a-z-]*(?:\s+[a-z][a-z-]*)?)\s+series\b/iu);
  if(explicit)labels.push(explicit[1]);
  const tokens=clean(name).split(/\s+/);
  const model=tokens.find(t=>/^[a-z]{1,6}-\d+[a-z\d-]*$/i.test(t));
  if(model)labels.push(model.toUpperCase());
  if(labels.length)return {name:labels.join(' · ').slice(0,80),strong:true};
  // Compare signatures across this file, ignoring device versions, colours and sizes.
  const remainder=info.match?text.replace(info.match,''):text.replace(norm(info.name),'');
  const signature=remainder.split(/\s+/).filter(t=>/^[a-zа-я][a-zа-я-]*$/iu.test(t)&&!stopWords.has(t)&&!devices.test(t)&&!variant.test(t)).slice(0,3).join(' ');
  return {name:title(signature).slice(0,80),strong:false};
}
export function proposeGroups(products,previous=[]){
  const saved=new Map(previous.filter(p=>clean(p.group)).map(p=>[p.id,p]));
  const infos=products.map(p=>family(p.name)),roots=new Map();
  // Shared leading words combine previously unseen families in this file.
  for(const info of infos.filter(i=>!i.known)){
    const root=norm(info.name).split(' ')[0];
    if(!roots.has(root))roots.set(root,info.name.split(' '));
    else {const common=roots.get(root),parts=info.name.split(' ');let n=0;while(n<common.length&&norm(common[n])===norm(parts[n]??''))n++;roots.set(root,common.slice(0,n));}
  }
  for(const info of infos.filter(i=>!i.known))info.name=roots.get(norm(info.name).split(' ')[0]).join(' ');
  const candidates=products.map((p,i)=>series(p.name,infos[i])),counts=new Map(),tokens=new Map();
  candidates.forEach((c,i)=>{const familyKey=norm(infos[i].name)+'\0',key=familyKey+norm(c.name);counts.set(key,(counts.get(key)||0)+1);for(const token of new Set(norm(c.name).split(' ').filter(Boolean)))tokens.set(familyKey+token,(tokens.get(familyKey+token)||0)+1);});
  return products.map((p,i)=>{
    const old=clean(p.group)?p:saved.get(p.id),info=infos[i],candidate=candidates[i];
    if(old)return {...p,group:clean(old.group),subgroup:clean(old.subgroup),groupingNote:'Сохранённая группа',groupingNeedsReview:false};
    const sharedSignature=candidate.name.split(' ').length>1&&candidate.name.split(' ').some(t=>tokens.get(norm(info.name)+'\0'+norm(t))>=2);
    const subgroup=candidate.name&&(candidate.strong||counts.get(norm(info.name)+'\0'+norm(candidate.name))>=2||sharedSignature)?candidate.name:'';
    return {...p,group:info.name,subgroup,groupingNeedsReview:!info.known||!candidate.strong,
      groupingNote:!info.known?'Группа по общему началу названия — проверьте':subgroup?'Подгруппа по типу, серии или повторяющейся части названия':'Тип найден; подгруппа не определена'};
  });
}
export function groupProducts(products){
  const proposed=proposeGroups(products),groups=new Map();
  products.forEach((product,i)=>{
    const {group,subgroup}=proposed[i],key=norm(group);
    if(!groups.has(key))groups.set(key,{name:group,products:[],buckets:new Map()});
    const target=groups.get(key);target.products.push(product);
    const subkey=norm(subgroup);
    if(!target.buckets.has(subkey))target.buckets.set(subkey,{name:subgroup,products:[]});
    target.buckets.get(subkey).products.push(product);
  });
  return [...groups.values()].map(({buckets,...group})=>({...group,subgroups:[...buckets.values()]}));
}
