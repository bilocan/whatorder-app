function basketSubtotal(basket) {
  return (basket ?? []).reduce((s, i) => s + i.price * i.qty, 0);
}

function orderTotals(basket, session, info, deal = null) {
  const subtotal = basketSubtotal(basket);
  const isDelivery = session.orderType === 'delivery';
  const deliveryFee = isDelivery ? (info.deliveryFee || 0) : 0;
  const discount = Math.min(Number(deal?.discount) || 0, subtotal);
  const total = subtotal - discount + deliveryFee;
  return { subtotal, deliveryFee, discount, total, isDelivery, deal: deal || null };
}

module.exports = { basketSubtotal, orderTotals };
