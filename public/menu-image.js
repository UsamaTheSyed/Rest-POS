export function menuImageUrl(product,width=600) {
  if(/^\/api\/menu-images\/[a-f0-9-]{36}$/.test(product.image||''))return product.image;
  if(/^photo-[a-zA-Z0-9-]+$/.test(product.image||''))return `https://images.unsplash.com/${product.image}?auto=format&fit=crop&w=${width}&q=80`;
  return '/menu-placeholder.svg';
}
export function validateImageFile(file) {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPG, PNG or WebP image.');
  if(!file.size || file.size>2*1024*1024)throw new Error('Choose an image no larger than 2 MB.');
}
export async function readImageFile(file) {
  validateImageFile(file);
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('Could not read the selected image. Please select it again.'));
    reader.onload=()=>resolve({type:file.type,data:String(reader.result).split(',')[1]});
    reader.readAsDataURL(file);
  });
}
