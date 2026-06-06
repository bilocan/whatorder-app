const { db } = require('./firebase');

const businessRef = (businessId) =>
  db.collection('businesses').doc(businessId);

const menuRef = (businessId) =>
  businessRef(businessId).collection('menu');

const ordersRef = (businessId) =>
  businessRef(businessId).collection('orders');

const customersRef = (businessId) =>
  businessRef(businessId).collection('customers');

module.exports = { businessRef, menuRef, ordersRef, customersRef };
