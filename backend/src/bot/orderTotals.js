function basketSubtotal(basket) {
  return (basket ?? []).reduce((s, i) => s + i.price * i.qty, 0);
}

function orderTotals(basket, session, info) {
  const subtotal = basketSubtotal(basket);
  const isDelivery = session.orderType === 'delivery';
  const deliveryFee = isDelivery ? (info.deliveryFee || 0) : 0;
  const total = isDelivery ? subtotal + deliveryFee : subtotal;
  return { subtotal, deliveryFee, total, isDelivery };
}

module.exports = { basketSubtotal, orderTotals };
