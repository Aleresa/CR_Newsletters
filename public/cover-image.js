// Compress a manually selected shipment cover before saving it in the catalog.
// The resulting data URI uses the same safe storage format as product images.
export async function compressCover(file){
  if(!file || !/^image\/(jpeg|png|webp)$/.test(file.type))throw Error('Поддерживаются только JPG, PNG и WebP.');
  if(file.size>12*1024*1024)throw Error('Размер обложки не должен превышать 12 МБ.');
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;
    try{await image.decode();}catch{throw Error('Не удалось открыть изображение. Используйте JPG, PNG или WebP.');}
    if(!image.naturalWidth || !image.naturalHeight)throw Error('Пустое изображение.');
    // A 16:9 cover is sufficient for shipment cards while keeping Durable Object storage compact.
    const canvas=document.createElement('canvas');
    const max=900,scale=Math.min(1,max/image.naturalWidth,max/image.naturalHeight);
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('Не удалось подготовить изображение.');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    let data=canvas.toDataURL('image/webp',0.77);
    while(data.length>180000 && canvas.width>200){
      canvas.width=Math.round(canvas.width*0.8);canvas.height=Math.round(canvas.height*0.8);
      ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      data=canvas.toDataURL('image/webp',0.65);
    }
    if(data.length>180000)throw Error('Обложка слишком сложная для сохранения. Выберите изображение меньшего размера.');
    return data;
  }finally{URL.revokeObjectURL(url);}
}
