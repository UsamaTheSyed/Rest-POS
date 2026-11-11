export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export function decodeMenuImage(input) {
  const invalid = message => { throw Object.assign(new Error(message), {status:400}); };
  if(!input || typeof input !== 'object' || typeof input.data !== 'string')invalid('Invalid menu image');
  if(input.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4)invalid('Image must be 2 MB or smaller');
  if(!input.data || input.data.length%4!==0 || /[^A-Za-z0-9+/=]/.test(input.data))invalid('Invalid image encoding');
  const bytes=Buffer.from(input.data,'base64');
  if(bytes.toString('base64')!==input.data)invalid('Invalid image encoding');
  if(bytes.length>MAX_IMAGE_BYTES)invalid('Image must be 2 MB or smaller');
  const png=bytes.length>=33 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii',12,16)==='IHDR';
  const jpeg=bytes.length>=4 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255 && bytes[bytes.length-2]===255 && bytes[bytes.length-1]===217;
  const webp=bytes.length>=20 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP' && ['VP8 ','VP8L','VP8X'].includes(bytes.toString('ascii',12,16));
  const type=png?'image/png':jpeg?'image/jpeg':webp?'image/webp':null;
  if(!type || type!==input.type)invalid('Choose a JPG, PNG or WebP image');
  return {bytes,type};
}
