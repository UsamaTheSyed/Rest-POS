export const menu=[
{id:1,name:'The Classic Smash',desc:'Beef patty, cheddar, house sauce',price:590,category:'Burgers',image:'photo-1568901346375-23c9450c58cd',tag:'BESTSELLER'},
{id:2,name:'Double Trouble',desc:'Double beef, double cheese',price:890,category:'Burgers',image:'photo-1550547660-d9450f859349'},
{id:3,name:'Crispy Chicken',desc:'Golden chicken, slaw, spicy mayo',price:550,category:'Burgers',image:'photo-1606755962773-d324e0a13086',tag:'POPULAR'},
{id:4,name:'Firehouse Burger',desc:'Beef, jalapeños, fiery house sauce',price:690,category:'Burgers',image:'photo-1553979459-d2229ba7433a',tag:'SPICY'},
{id:5,name:'Golden Chicken Bucket',desc:'6 crispy, perfectly seasoned pieces',price:1490,category:'Chicken',image:'photo-1626082927389-6cd097cdc6ec'},
{id:6,name:'Crispy Tenders',desc:'4 chicken strips with signature dip',price:490,category:'Chicken',image:'photo-1562967914-608f82629710'},
{id:7,name:'Loaded Fries',desc:'Crispy fries, cheese, house sauce',price:390,category:'Sides',image:'photo-1573080496219-bb080dd4f877'},
{id:8,name:'Classic Fries',desc:'Golden fries with sea salt',price:220,category:'Sides',image:'photo-1630384060421-cb20d0e0649d'},
{id:9,name:'Ice-cold Cola',desc:'Chilled cola · 500 ml',price:150,category:'Drinks',image:'photo-1622483767028-3f66f32aef97'},
{id:10,name:'Chocolate Shake',desc:'Creamy chocolate with whipped cream',price:350,category:'Drinks',image:'photo-1572490122747-3968b75cc699'},
{id:11,name:'Chocolate Brownie',desc:'Rich chocolate, baked fresh',price:290,category:'Desserts',image:'photo-1606313564200-e75d5e30476c'},
{id:12,name:'Classic Combo',desc:'Classic Smash + fries + cola',price:790,category:'Deals',image:'photo-1568901346375-23c9450c58cd',tag:'SAVE Rs. 170'},
{id:13,name:'Two’s a Party',desc:'2 crispy burgers + 2 fries + 2 colas',price:1390,category:'Deals',image:'photo-1550547660-d9450f859349',tag:'SAVE Rs. 450'},
{id:14,name:'Family Feast',desc:'4 burgers + 2 fries + 4 colas',price:2490,category:'Deals',image:'photo-1626082927389-6cd097cdc6ec',tag:'FAMILY FAVORITE'}];
export function totals(cart){const subtotal=cart.reduce((sum,item)=>sum+item.price*item.qty,0);const tax=Math.round(subtotal*.05);return {subtotal,tax,total:subtotal+tax};}
export const money=n=>'Rs. '+n.toLocaleString('en-PK');
