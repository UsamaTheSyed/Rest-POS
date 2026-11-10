export const MAX_QUANTITY = 999;
export function parseQuantity(value) {
  const text=String(value).trim();
  if(!/^\d+$/.test(text))return null;
  const quantity=Number(text);
  return Number.isInteger(quantity)&&quantity>=1&&quantity<=MAX_QUANTITY?quantity:null;
}
