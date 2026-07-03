/* @ds-bundle: {"format":3,"namespace":"WhatOrderDesignSystem_b54bed","components":[{"name":"BrandLogo","sourcePath":"components/brand/BrandLogo.jsx"},{"name":"Button","sourcePath":"components/buttons/Button.jsx"},{"name":"Badge","sourcePath":"components/feedback/Badge.jsx"},{"name":"PaymentBadge","sourcePath":"components/feedback/PaymentBadge.jsx"},{"name":"StatusBadge","sourcePath":"components/feedback/StatusBadge.jsx"},{"name":"Tag","sourcePath":"components/feedback/Tag.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"QuoteBlock","sourcePath":"components/marketing/QuoteBlock.jsx"},{"name":"SectionLabel","sourcePath":"components/marketing/SectionLabel.jsx"},{"name":"StepCard","sourcePath":"components/marketing/StepCard.jsx"},{"name":"Card","sourcePath":"components/surfaces/Card.jsx"}],"sourceHashes":{"components/brand/BrandLogo.jsx":"99110f7d7629","components/buttons/Button.jsx":"06a4dbb364b1","components/feedback/Badge.jsx":"72d7c9ae217d","components/feedback/PaymentBadge.jsx":"585178be872a","components/feedback/StatusBadge.jsx":"aea14652a404","components/feedback/Tag.jsx":"6a3c3d58c25f","components/forms/Input.jsx":"5ffaf8717e9b","components/forms/Select.jsx":"94f5d004943f","components/marketing/QuoteBlock.jsx":"53c2a83b2108","components/marketing/SectionLabel.jsx":"3be97835b815","components/marketing/StepCard.jsx":"e7094f8b5735","components/surfaces/Card.jsx":"cd61a4696711","ui_kits/dashboard/LoginScreen.jsx":"18305b170b14","ui_kits/dashboard/MenuScreen.jsx":"33fd1c63e273","ui_kits/dashboard/OrderDetailScreen.jsx":"ee1569514969","ui_kits/dashboard/OrdersScreen.jsx":"78e9d4077aee","ui_kits/dashboard/Sidebar.jsx":"81b353f88fcc","ui_kits/dashboard/data.js":"e2de9775c3ce"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.WhatOrderDesignSystem_b54bed = window.WhatOrderDesignSystem_b54bed || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/brand/BrandLogo.jsx
try { (() => {
/**
 * WhatOrder brand lockup: the rounded-tile mark (menu lines + check) plus the
 * "WhatOrder" wordmark, where "Order" is set in brand green.
 * SVG paths are reproduced verbatim from the product's own logo asset.
 */

const ICON_PX = {
  sm: 24,
  md: 32,
  lg: 48
};
const FONT_REM = {
  sm: '0.95rem',
  md: '1.05rem',
  lg: '1.35rem'
};
function BrandLogo({
  size = 'md',
  showWordmark = true,
  variant = 'light',
  glow = false
}) {
  const px = ICON_PX[size] ?? ICON_PX.md;
  const gid = React.useId ? React.useId().replace(/:/g, '') : 'wo';
  const wordColor = variant === 'dark' ? 'var(--ink-fg)' : 'var(--slate-ink)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: size === 'sm' ? '0.45rem' : '0.55rem'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: px,
    height: px,
    viewBox: "0 0 48 48",
    fill: "none",
    role: "img",
    "aria-label": "WhatOrder",
    style: {
      flexShrink: 0,
      filter: glow ? 'drop-shadow(var(--glow-accent))' : 'none'
    }
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: `wo-${gid}`,
    x1: "8",
    y1: "6",
    x2: "40",
    y2: "42",
    gradientUnits: "userSpaceOnUse"
  }, /*#__PURE__*/React.createElement("stop", {
    stopColor: "var(--green-500)"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "1",
    stopColor: "var(--green-700)"
  }))), /*#__PURE__*/React.createElement("rect", {
    x: "4",
    y: "4",
    width: "40",
    height: "40",
    rx: "12",
    fill: `url(#wo-${gid})`
  }), /*#__PURE__*/React.createElement("path", {
    d: "M14 16h20M14 24h16M14 32h12",
    stroke: "#fff",
    strokeWidth: "2.5",
    strokeLinecap: "round"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M30 30l3 3 6-7",
    stroke: "#fff",
    strokeWidth: "2.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })), showWordmark && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontWeight: 'var(--fw-semibold)',
      letterSpacing: 'var(--tracking-tight)',
      fontSize: FONT_REM[size] ?? FONT_REM.md,
      lineHeight: 1,
      color: wordColor
    }
  }, "What", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--green-500)'
    }
  }, "Order")));
}
Object.assign(__ds_scope, { BrandLogo });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/BrandLogo.jsx", error: String((e && e.message) || e) }); }

// components/buttons/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * WhatOrder button. Two primary flavors match the two surfaces:
 * `primary` (solid black — dashboard) and `accent` (solid green — marketing).
 * `ghost` and `danger` round out the set. `tone` overrides the fill with any
 * order-status hue for lifecycle action buttons (Approve / Prepare / …).
 */

const SIZES = {
  sm: {
    padding: '0.45rem 1rem',
    fontSize: 'var(--text-sm)'
  },
  md: {
    padding: '0.7rem 1.5rem',
    fontSize: '0.95rem'
  },
  lg: {
    padding: '0.8rem 1.8rem',
    fontSize: '0.95rem'
  }
};
function baseFill(variant) {
  switch (variant) {
    case 'accent':
      return {
        bg: 'var(--green-500)',
        bgHover: 'var(--green-600)',
        fg: '#000',
        border: 'transparent',
        lift: true
      };
    case 'ghost':
      return {
        bg: 'transparent',
        bgHover: 'transparent',
        fg: 'var(--text)',
        border: 'var(--border)',
        borderHover: 'var(--border-hover)'
      };
    case 'danger':
      return {
        bg: 'var(--danger)',
        bgHover: '#dc2626',
        fg: '#fff',
        border: 'transparent'
      };
    case 'primary':
    default:
      return {
        bg: 'var(--slate-ink)',
        bgHover: '#222',
        fg: '#fff',
        border: 'transparent'
      };
  }
}
function Button({
  variant = 'primary',
  size = 'md',
  tone,
  fullWidth = false,
  disabled = false,
  type = 'button',
  onClick,
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const f = baseFill(variant);
  const sz = SIZES[size] ?? SIZES.md;
  const bg = tone ?? (hover ? f.bgHover : f.bg);
  const borderColor = hover && f.borderHover ? f.borderHover : f.border;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0.5rem',
      width: fullWidth ? '100%' : 'auto',
      fontFamily: 'var(--font-sans)',
      fontWeight: 'var(--fw-semibold)',
      fontSize: sz.fontSize,
      padding: sz.padding,
      color: tone ? '#fff' : f.fg,
      background: bg,
      border: `1px solid ${borderColor}`,
      borderRadius: 'var(--radius-md)',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.6 : 1,
      transform: f.lift && hover && !disabled ? 'translateY(-1px)' : 'none',
      transition: 'background 0.2s, border-color 0.2s, transform 0.2s, opacity 0.2s',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/buttons/Button.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Badge.jsx
try { (() => {
/**
 * Marketing status pill — green text on an accent wash with a pulsing dot.
 * Used for the "Pilot · Vienna" eyebrow on the dark site. Uppercase, tracked.
 */

function Badge({
  children,
  pulse = true,
  style
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.5rem',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-sm)',
      fontWeight: 'var(--fw-medium)',
      color: 'var(--accent)',
      background: 'var(--accent-wash)',
      border: '1px solid rgba(34, 197, 94, 0.25)',
      padding: '0.35rem 0.9rem',
      borderRadius: 'var(--radius-pill)',
      letterSpacing: 'var(--tracking-wide)',
      textTransform: 'uppercase',
      ...style
    }
  }, pulse && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: 'var(--accent)',
      animation: 'wo-pulse 2s infinite'
    }
  }), /*#__PURE__*/React.createElement("style", null, '@keyframes wo-pulse{0%,100%{opacity:1}50%{opacity:.3}}'), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Badge.jsx", error: String((e && e.message) || e) }); }

// components/feedback/PaymentBadge.jsx
try { (() => {
/**
 * Payment-state pill. Same translucent-fill treatment as StatusBadge, in the
 * payment hue set: cash (amber), paid (green), unpaid (amber), failed (red).
 */

const KINDS = {
  cash: {
    c: 'var(--pay-cash)',
    label: 'Cash'
  },
  paid: {
    c: 'var(--pay-paid)',
    label: 'Paid'
  },
  unpaid: {
    c: 'var(--pay-unpaid)',
    label: 'Unpaid'
  },
  failed: {
    c: 'var(--pay-failed)',
    label: 'Failed'
  }
};
function PaymentBadge({
  kind = 'cash',
  label,
  style
}) {
  const k = KINDS[kind] ?? KINDS.cash;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-block',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-sm)',
      fontWeight: 'var(--fw-semibold)',
      color: k.c,
      background: `color-mix(in srgb, ${k.c} 13%, transparent)`,
      padding: '0.2rem 0.6rem',
      borderRadius: 'var(--radius-pill)',
      lineHeight: 1.5,
      whiteSpace: 'nowrap',
      ...style
    }
  }, label ?? k.label);
}
Object.assign(__ds_scope, { PaymentBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/PaymentBadge.jsx", error: String((e && e.message) || e) }); }

// components/feedback/StatusBadge.jsx
try { (() => {
/**
 * Order-status pill. Renders the status label in its lifecycle hue on a
 * translucent fill of the same hue — the dashboard's core status signature.
 */

const STATUS = {
  pending: {
    c: 'var(--status-pending)',
    label: 'Pending'
  },
  approved: {
    c: 'var(--status-approved)',
    label: 'Approved'
  },
  preparing: {
    c: 'var(--status-preparing)',
    label: 'Preparing'
  },
  ready: {
    c: 'var(--status-ready)',
    label: 'Ready for pickup'
  },
  on_the_way: {
    c: 'var(--status-on-the-way)',
    label: 'Out for delivery'
  },
  picked_up: {
    c: 'var(--status-picked-up)',
    label: 'Picked up'
  },
  delivered: {
    c: 'var(--status-delivered)',
    label: 'Delivered'
  },
  completed: {
    c: 'var(--status-completed)',
    label: 'Completed'
  },
  rejected: {
    c: 'var(--status-rejected)',
    label: 'Rejected'
  },
  cancelled: {
    c: 'var(--status-cancelled)',
    label: 'Cancelled'
  }
};
function StatusBadge({
  status = 'pending',
  label,
  style
}) {
  const s = STATUS[status] ?? STATUS.pending;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-block',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-sm)',
      fontWeight: 'var(--fw-semibold)',
      color: s.c,
      background: `color-mix(in srgb, ${s.c} 13%, transparent)`,
      padding: '0.2rem 0.6rem',
      borderRadius: 'var(--radius-pill)',
      lineHeight: 1.5,
      whiteSpace: 'nowrap',
      ...style
    }
  }, label ?? s.label);
}
Object.assign(__ds_scope, { StatusBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/StatusBadge.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tag.jsx
try { (() => {
/**
 * Neutral category chip used in the marketing "who it's for" list
 * (Döner & Kebab, Pizzerias, …). Muted text on the page bg with a hairline border.
 */

function Tag({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-block',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-sm)',
      fontWeight: 'var(--fw-medium)',
      color: 'var(--text-muted)',
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      padding: '0.35rem 0.9rem',
      borderRadius: 'var(--radius-pill)',
      whiteSpace: 'nowrap',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tag.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Text input. Adapts to surface: `light` (dashboard — #ddd border on white)
 * or `dark` (marketing — raised bg, green focus ring). Focus tints the border.
 */

function Input({
  surface = 'light',
  label,
  id,
  style,
  wrapperStyle,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const dark = surface === 'dark';
  const borderColor = focus ? dark ? 'rgba(34,197,94,0.5)' : 'var(--green-500)' : dark ? 'var(--border)' : 'var(--input-border)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.4rem',
      ...wrapperStyle
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: id,
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-sm)',
      fontWeight: dark ? 'var(--fw-medium)' : 'var(--fw-semibold)',
      color: dark ? 'var(--text-muted)' : 'var(--text-strong)'
    }
  }, label), /*#__PURE__*/React.createElement("input", _extends({
    id: id,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      width: '100%',
      boxSizing: 'border-box',
      fontFamily: 'var(--font-sans)',
      fontSize: dark ? '0.95rem' : 'var(--text-md)',
      padding: dark ? '0.75rem 1rem' : '0.65rem',
      color: dark ? 'var(--text)' : 'var(--text-body)',
      background: dark ? 'var(--bg-raised)' : 'var(--surface)',
      border: `1px solid ${borderColor}`,
      borderRadius: 'var(--radius-md)',
      outline: 'none',
      transition: 'border-color 0.2s',
      ...style
    }
  }, rest)));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Dashboard select — compact control on a light control fill with a custom
 * chevron (native arrow suppressed). Options passed as {value,label} pairs.
 */

function Select({
  options = [],
  value,
  onChange,
  ariaLabel,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-block'
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    value: value,
    onChange: onChange,
    "aria-label": ariaLabel,
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-sm)',
      color: 'var(--text-secondary)',
      background: 'var(--surface-control)',
      border: '1px solid var(--surface-border-strong)',
      borderRadius: 'var(--radius-sm)',
      padding: '0.35rem 2rem 0.35rem 0.6rem',
      cursor: 'pointer',
      appearance: 'none',
      WebkitAppearance: 'none',
      outline: 'none',
      ...style
    }
  }, rest), options.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label))), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": true,
    style: {
      position: 'absolute',
      right: '0.5rem',
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none',
      fontSize: '0.6rem',
      color: 'var(--text-quiet)'
    }
  }, "\u25BC"));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/marketing/QuoteBlock.jsx
try { (() => {
/**
 * Testimonial block for the marketing site — italic quote on the page bg
 * inside a bordered panel, with a muted attribution line.
 */

function QuoteBlock({
  quote,
  author,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-xl)',
      padding: 'var(--space-6)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-lg)',
      fontStyle: 'italic',
      color: 'var(--text)',
      lineHeight: 'var(--lh-relaxed)',
      marginBottom: '1.2rem'
    }
  }, quote), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-sm)',
      color: 'var(--text-muted)'
    }
  }, author));
}
Object.assign(__ds_scope, { QuoteBlock });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/QuoteBlock.jsx", error: String((e && e.message) || e) }); }

// components/marketing/SectionLabel.jsx
try { (() => {
/**
 * Section eyebrow — the small green uppercase label above marketing headings
 * ("How it works", "Who it's for").
 */

function SectionLabel({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-xs)',
      fontWeight: 'var(--fw-semibold)',
      letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase',
      color: 'var(--accent)',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { SectionLabel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/SectionLabel.jsx", error: String((e && e.message) || e) }); }

// components/marketing/StepCard.jsx
try { (() => {
/**
 * Numbered feature step from the marketing "how it works" grid. Green step
 * label, tight heading, muted body — on a dark card that brightens on hover.
 */

function StepCard({
  step,
  title,
  children,
  style
}) {
  const [h, setH] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      background: 'var(--bg-raised)',
      border: `1px solid ${h ? 'var(--border-hover)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-xl)',
      padding: 'var(--space-6)',
      transition: 'border-color 0.2s',
      ...style
    }
  }, step && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-xs)',
      fontWeight: 'var(--fw-bold)',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'var(--accent)',
      marginBottom: 'var(--space-4)'
    }
  }, step), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-lg)',
      fontWeight: 'var(--fw-semibold)',
      letterSpacing: 'var(--tracking-tight)',
      color: 'var(--text)',
      marginBottom: '0.6rem'
    }
  }, title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-base)',
      color: 'var(--text-muted)',
      lineHeight: 'var(--lh-body)'
    }
  }, children));
}
Object.assign(__ds_scope, { StepCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/StepCard.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Surface container. `light` = white dashboard card (soft shadow, radius 12);
 * `dark` = marketing panel (raised bg, hairline border, border brightens on hover).
 */

function Card({
  surface = 'light',
  hover = false,
  style,
  children,
  ...rest
}) {
  const [h, setH] = React.useState(false);
  const dark = surface === 'dark';
  return /*#__PURE__*/React.createElement("div", _extends({
    onMouseEnter: hover ? () => setH(true) : undefined,
    onMouseLeave: hover ? () => setH(false) : undefined,
    style: {
      background: dark ? 'var(--bg-raised)' : 'var(--surface)',
      border: dark ? `1px solid ${h ? 'var(--border-hover)' : 'var(--border)'}` : '1px solid var(--surface-border)',
      borderRadius: 'var(--radius-xl)',
      boxShadow: dark ? 'none' : 'var(--shadow-card)',
      padding: 'var(--space-6)',
      transition: 'border-color 0.2s',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/Card.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/LoginScreen.jsx
try { (() => {
// Phone OTP login screen — composes BrandLogo, Input, Button, Card.
const {
  BrandLogo: WOBrandLogo,
  Input: WOInput,
  Button: WOButton,
  Card: WOCard
} = window.WhatOrderDesignSystem_b54bed;
function LoginScreen({
  onSignedIn
}) {
  const [step, setStep] = React.useState('phone');
  const [phone, setPhone] = React.useState('+43 660 123 4567');
  const [code, setCode] = React.useState('');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100%',
      background: 'var(--surface-app)',
      padding: '2rem'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 320
    }
  }, /*#__PURE__*/React.createElement(WOCard, {
    surface: "light",
    style: {
      padding: '2rem'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '0.5rem'
    }
  }, /*#__PURE__*/React.createElement(WOBrandLogo, {
    size: "lg",
    variant: "light"
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--text-quiet)',
      fontSize: 'var(--text-base)',
      margin: '0 0 1.5rem'
    }
  }, "Owner dashboard"), step === 'phone' ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem'
    }
  }, /*#__PURE__*/React.createElement(WOInput, {
    surface: "light",
    label: "Phone number",
    value: phone,
    onChange: e => setPhone(e.target.value)
  }), /*#__PURE__*/React.createElement(WOButton, {
    variant: "primary",
    fullWidth: true,
    onClick: () => setStep('otp')
  }, "Send code")) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--text-base)',
      color: 'var(--text-tertiary)',
      margin: 0
    }
  }, "Code sent to ", phone), /*#__PURE__*/React.createElement(WOInput, {
    surface: "light",
    label: "Verification code",
    value: code,
    placeholder: "123456",
    onChange: e => setCode(e.target.value),
    style: {
      fontSize: '1.25rem',
      letterSpacing: '0.2em',
      textAlign: 'center'
    }
  }), /*#__PURE__*/React.createElement(WOButton, {
    variant: "primary",
    fullWidth: true,
    onClick: onSignedIn
  }, "Sign in"), /*#__PURE__*/React.createElement("a", {
    onClick: () => setStep('phone'),
    style: {
      textAlign: 'center',
      color: 'var(--text-tertiary)',
      fontSize: 'var(--text-sm)',
      cursor: 'pointer'
    }
  }, "Use a different number")))));
}
window.LoginScreen = LoginScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/LoginScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/MenuScreen.jsx
try { (() => {
// Menu screen — item list grouped by category, availability toggle, Button.
const WOMenu = window.WhatOrderDesignSystem_b54bed;
function MenuScreen({
  menu,
  onToggle
}) {
  const cats = ['Mains', 'Sides', 'Drinks'];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontSize: 'var(--text-xl)',
      color: 'var(--text-strong)'
    }
  }, "Menu"), /*#__PURE__*/React.createElement(WOMenu.Button, {
    variant: "primary",
    size: "sm"
  }, "+ Add item")), cats.map(cat => /*#__PURE__*/React.createElement("div", {
    key: cat,
    style: {
      marginBottom: '1.5rem'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--text-xs)',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      color: 'var(--text-quiet)',
      fontWeight: 600,
      margin: '0 0 0.5rem'
    }
  }, cat), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.4rem'
    }
  }, menu.filter(m => m.category === cat).map(m => /*#__PURE__*/React.createElement("div", {
    key: m.name,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.75rem',
      padding: '0.6rem 0.75rem',
      background: 'var(--surface)',
      border: '1px solid var(--surface-border)',
      borderRadius: 'var(--radius-md)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontWeight: 500,
      color: 'var(--text-strong)',
      opacity: m.available ? 1 : 0.45
    }
  }, m.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: 'var(--text-body)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, "\u20AC", m.price.toFixed(2)), /*#__PURE__*/React.createElement("button", {
    onClick: () => onToggle(m.name),
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: '0.72rem',
      fontWeight: 600,
      cursor: 'pointer',
      padding: '0.2rem 0.7rem',
      borderRadius: 'var(--radius-pill)',
      border: 'none',
      background: m.available ? 'var(--success-soft-bg)' : 'var(--paper-200)',
      color: m.available ? 'var(--success-soft-fg)' : 'var(--text-quiet)'
    }
  }, m.available ? 'Available' : 'Off')))))));
}
window.MenuScreen = MenuScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/MenuScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/OrderDetailScreen.jsx
try { (() => {
// Order detail — lifecycle actions via Button `tone`, StatusBadge, PaymentBadge.
const WODetail = window.WhatOrderDesignSystem_b54bed;
const STATUS_LABEL = {
  pending: 'Pending',
  approved: 'Approved',
  preparing: 'Preparing',
  ready: 'Ready for pickup',
  on_the_way: 'Out for delivery',
  picked_up: 'Picked up',
  delivered: 'Delivered',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  completed: 'Completed'
};
function actionsFor(status, type) {
  switch (status) {
    case 'pending':
      return [{
        label: 'Approve',
        next: 'approved',
        variant: 'primary'
      }, {
        label: 'Reject',
        next: 'rejected',
        variant: 'danger'
      }];
    case 'approved':
      return [{
        label: 'Start Preparation',
        next: 'preparing',
        tone: 'var(--status-preparing)'
      }];
    case 'preparing':
      return type === 'delivery' ? [{
        label: 'Out for Delivery',
        next: 'on_the_way',
        tone: 'var(--status-on-the-way)'
      }] : [{
        label: 'Mark Ready',
        next: 'ready',
        tone: 'var(--status-ready)'
      }];
    case 'ready':
      return [{
        label: 'Mark Picked Up',
        next: 'picked_up',
        tone: 'var(--status-delivered)'
      }];
    case 'on_the_way':
      return [{
        label: 'Mark Delivered',
        next: 'delivered',
        tone: 'var(--status-delivered)'
      }];
    default:
      return [];
  }
}
function OrderDetailScreen({
  order,
  onBack,
  onAdvance
}) {
  const buttons = actionsFor(order.status, order.type);
  const th = {
    padding: '0.4rem 0',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-tertiary)',
    fontWeight: 600,
    textAlign: 'left'
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 480
    }
  }, /*#__PURE__*/React.createElement("a", {
    onClick: onBack,
    style: {
      fontSize: 'var(--text-base)',
      color: 'var(--text-tertiary)',
      cursor: 'pointer'
    }
  }, "\u2190 Back to orders"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      marginTop: '0.75rem'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontSize: 'var(--text-xl)',
      color: 'var(--text-strong)'
    }
  }, order.customerName), order.type === 'delivery' && /*#__PURE__*/React.createElement("span", {
    style: {
      background: 'color-mix(in srgb, var(--delivery) 13%, transparent)',
      color: 'var(--delivery)',
      padding: '0.15rem 0.6rem',
      borderRadius: 'var(--radius-pill)',
      fontSize: '0.75rem',
      fontWeight: 700
    }
  }, "Delivery")), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--text-quiet)',
      margin: '0.25rem 0 0',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)'
    }
  }, "#", order.shortId), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--text-quiet)',
      margin: '0.1rem 0 0'
    }
  }, order.customerPhone), order.type === 'delivery' && order.deliveryAddress && /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--delivery)',
      fontSize: 'var(--text-base)',
      margin: '0.5rem 0 0'
    }
  }, "\uD83D\uDE9A ", order.deliveryAddress), /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      margin: '1.25rem 0 1rem'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      borderBottom: '2px solid var(--surface-border)'
    }
  }, /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Item"), /*#__PURE__*/React.createElement("th", {
    style: {
      ...th,
      textAlign: 'center'
    }
  }, "Qty"), /*#__PURE__*/React.createElement("th", {
    style: {
      ...th,
      textAlign: 'right'
    }
  }, "Price"))), /*#__PURE__*/React.createElement("tbody", null, order.items.map((it, i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    style: {
      borderBottom: '1px solid var(--paper-200)'
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '0.5rem 0',
      color: 'var(--text-body)'
    }
  }, it.name), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '0.5rem',
      textAlign: 'center',
      color: 'var(--text-secondary)'
    }
  }, it.qty), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '0.5rem',
      textAlign: 'right',
      color: 'var(--text-body)'
    }
  }, "\u20AC", (it.price * it.qty).toFixed(2)))))), order.type === 'delivery' && order.deliveryFee ? /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--text-quiet)',
      textAlign: 'right',
      margin: 0
    }
  }, "Delivery fee: \u20AC", order.deliveryFee.toFixed(2)) : null, /*#__PURE__*/React.createElement("p", {
    style: {
      fontWeight: 700,
      fontSize: 'var(--text-lg)',
      textAlign: 'right',
      color: 'var(--text-strong)'
    }
  }, "Total: \u20AC", order.total.toFixed(2)), order.notes && /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--text-secondary)',
      background: 'var(--surface-app)',
      padding: '0.5rem 0.75rem',
      borderRadius: 'var(--radius-sm)',
      fontSize: 'var(--text-base)'
    }
  }, "Note: ", order.notes), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.6rem',
      margin: '1rem 0'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--text-tertiary)'
    }
  }, "Status"), /*#__PURE__*/React.createElement(WODetail.StatusBadge, {
    status: order.status
  }), /*#__PURE__*/React.createElement(WODetail.PaymentBadge, {
    kind: order.payment
  })), buttons.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '0.5rem',
      flexWrap: 'wrap'
    }
  }, buttons.map(b => /*#__PURE__*/React.createElement(WODetail.Button, {
    key: b.label,
    variant: b.variant || 'primary',
    tone: b.tone,
    onClick: () => onAdvance(order.id, b.next)
  }, b.label))), buttons.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--text-quiet)'
    }
  }, "This order is ", STATUS_LABEL[order.status].toLowerCase(), " \u2014 no further action."));
}
window.OrderDetailScreen = OrderDetailScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/OrderDetailScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/OrdersScreen.jsx
try { (() => {
// Orders list — composes StatusBadge, PaymentBadge, Select.
const WOOrders = window.WhatOrderDesignSystem_b54bed;
function OrdersScreen({
  orders,
  onOpen
}) {
  const [filter, setFilter] = React.useState('active');
  const TERMINAL = ['delivered', 'picked_up', 'rejected', 'cancelled', 'completed'];
  const visible = orders.filter(o => filter === 'active' ? !TERMINAL.includes(o.status) : TERMINAL.includes(o.status));
  const th = {
    padding: '0.5rem',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-tertiary)',
    fontWeight: 600
  };
  const td = {
    padding: '0.75rem 0.5rem',
    fontSize: 'var(--text-base)'
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontSize: 'var(--text-xl)',
      color: 'var(--text-strong)'
    }
  }, "Orders"), /*#__PURE__*/React.createElement(WOOrders.Select, {
    ariaLabel: "Show",
    value: filter,
    onChange: e => setFilter(e.target.value),
    options: [{
      value: 'active',
      label: 'Active orders'
    }, {
      value: 'done',
      label: 'Completed — last 2 weeks'
    }]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      minWidth: 640
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      textAlign: 'left',
      borderBottom: '2px solid var(--surface-border)'
    }
  }, /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Order #"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Customer"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Items"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Total"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Payment"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Status"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Time"))), /*#__PURE__*/React.createElement("tbody", null, visible.map(o => /*#__PURE__*/React.createElement("tr", {
    key: o.id,
    style: {
      borderBottom: '1px solid var(--paper-200)',
      cursor: 'pointer'
    },
    onClick: () => onOpen(o.id)
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      ...td,
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      color: 'var(--text-tertiary)'
    }
  }, "#", o.shortId), /*#__PURE__*/React.createElement("td", {
    style: td
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.4rem',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, o.customerName), o.type === 'delivery' && /*#__PURE__*/React.createElement("span", {
    style: {
      background: 'color-mix(in srgb, var(--delivery) 13%, transparent)',
      color: 'var(--delivery)',
      padding: '0.1rem 0.5rem',
      borderRadius: 'var(--radius-pill)',
      fontSize: '0.72rem',
      fontWeight: 700
    }
  }, "Delivery")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--text-quiet)'
    }
  }, o.customerPhone)), /*#__PURE__*/React.createElement("td", {
    style: {
      ...td,
      color: 'var(--text-secondary)'
    }
  }, o.items.map(i => `${i.qty}x ${i.name}`).join(', ')), /*#__PURE__*/React.createElement("td", {
    style: {
      ...td,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, "\u20AC", o.total.toFixed(2)), /*#__PURE__*/React.createElement("td", {
    style: td
  }, /*#__PURE__*/React.createElement(WOOrders.PaymentBadge, {
    kind: o.payment
  })), /*#__PURE__*/React.createElement("td", {
    style: td
  }, /*#__PURE__*/React.createElement(WOOrders.StatusBadge, {
    status: o.status
  })), /*#__PURE__*/React.createElement("td", {
    style: {
      ...td,
      color: 'var(--text-tertiary)',
      fontSize: 'var(--text-sm)'
    }
  }, o.time)))))));
}
window.OrdersScreen = OrdersScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/OrdersScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/Sidebar.jsx
try { (() => {
// Dashboard sidebar — composes BrandLogo. Presence panel + nav.
const {
  BrandLogo
} = window.WhatOrderDesignSystem_b54bed;
function Sidebar({
  active,
  onNavigate,
  restaurant,
  onSignOut
}) {
  const items = [['orders', 'Orders'], ['customers', 'Customers'], ['income', 'Income'], ['menu', 'Menu'], ['phrases', 'Phrases'], ['settings', 'Settings']];
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      width: 200,
      flexShrink: 0,
      padding: '1rem',
      borderRight: '1px solid var(--surface-border)',
      background: 'var(--surface)',
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement(BrandLogo, {
    size: "md",
    variant: "light"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      padding: '0.5rem 0.6rem',
      border: '1px solid var(--surface-border)',
      borderRadius: 'var(--radius-md)',
      marginBottom: '1rem',
      fontSize: 'var(--text-sm)',
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, restaurant), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-quiet)',
      fontSize: '0.6rem'
    }
  }, "\u25BC")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, items.map(([key, label]) => /*#__PURE__*/React.createElement("a", {
    key: key,
    onClick: () => onNavigate(key),
    style: {
      display: 'block',
      padding: '0.5rem 0',
      cursor: 'pointer',
      textDecoration: 'none',
      color: active === key ? 'var(--text-strong)' : 'var(--text-tertiary)',
      fontWeight: active === key ? 600 : 400,
      fontSize: 'var(--text-md)'
    }
  }, label))), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0.5rem 0 0.75rem',
      padding: '0.6rem 0.75rem',
      background: 'var(--surface-panel)',
      borderRadius: 'var(--radius-md)',
      fontSize: 'var(--text-xs)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.4rem',
      marginBottom: '0.5rem'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: 'var(--green-500)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-secondary)',
      fontWeight: 500
    }
  }, "Online \u2014 accepting orders")), /*#__PURE__*/React.createElement("button", {
    style: {
      width: '100%',
      padding: '0.3rem 0',
      background: 'var(--danger-soft-bg)',
      border: 'none',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--danger-soft-fg)',
      fontWeight: 600,
      cursor: 'pointer',
      fontSize: '0.75rem',
      fontFamily: 'var(--font-sans)'
    }
  }, "Pause orders")), /*#__PURE__*/React.createElement("a", {
    onClick: onSignOut,
    style: {
      padding: '0.5rem 0',
      color: 'var(--text-quiet)',
      fontSize: 'var(--text-sm)',
      cursor: 'pointer'
    }
  }, "Sign out"));
}
window.Sidebar = Sidebar;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/Sidebar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/data.js
try { (() => {
// Fake data for the WhatOrder dashboard UI kit.
window.WO_DATA = {
  restaurant: 'Kebap & Pizza Favoriten',
  orders: [{
    id: 'a1b2c3d4',
    shortId: 'A1B2C3',
    customerName: 'Mehmet Y.',
    customerPhone: '+43 660 123 4567',
    items: [{
      qty: 2,
      name: 'Döner Teller',
      price: 9.9
    }, {
      qty: 1,
      name: 'Ayran',
      price: 1.8
    }],
    total: 21.6,
    payment: 'paid',
    status: 'pending',
    type: 'pickup',
    time: '18:42',
    notes: 'Extra scharf bitte'
  }, {
    id: 'e5f6g7h8',
    shortId: 'E5F6G7',
    customerName: 'Anna K.',
    customerPhone: '+43 664 987 6543',
    items: [{
      qty: 1,
      name: 'Pizza Margherita',
      price: 8.5
    }, {
      qty: 1,
      name: 'Pizza Funghi',
      price: 9.5
    }],
    total: 20.5,
    payment: 'cash',
    status: 'preparing',
    type: 'delivery',
    deliveryFee: 2.5,
    deliveryAddress: 'Quellenstraße 12, 1100 Wien',
    time: '18:35'
  }, {
    id: 'i9j0k1l2',
    shortId: 'I9J0K1',
    customerName: 'Thomas B.',
    customerPhone: '+43 699 111 2233',
    items: [{
      qty: 1,
      name: 'Dürüm Chicken',
      price: 7.5
    }],
    total: 7.5,
    payment: 'paid',
    status: 'ready',
    type: 'pickup',
    time: '18:28'
  }, {
    id: 'm3n4o5p6',
    shortId: 'M3N4O5',
    customerName: 'Sara L.',
    customerPhone: '+43 660 555 4433',
    items: [{
      qty: 3,
      name: 'Falafel Wrap',
      price: 6.9
    }, {
      qty: 2,
      name: 'Cola 0.5l',
      price: 2.5
    }],
    total: 25.7,
    payment: 'unpaid',
    status: 'approved',
    type: 'delivery',
    deliveryFee: 2.5,
    deliveryAddress: 'Favoritenstraße 88, 1100 Wien',
    time: '18:20'
  }, {
    id: 'q7r8s9t0',
    shortId: 'Q7R8S9',
    customerName: 'David M.',
    customerPhone: '+43 664 222 1100',
    items: [{
      qty: 1,
      name: 'Lahmacun',
      price: 5.5
    }, {
      qty: 1,
      name: 'Ayran',
      price: 1.8
    }],
    total: 7.3,
    payment: 'paid',
    status: 'delivered',
    type: 'pickup',
    time: '17:55'
  }],
  menu: [{
    name: 'Döner Teller',
    category: 'Mains',
    price: 9.9,
    available: true
  }, {
    name: 'Dürüm Chicken',
    category: 'Mains',
    price: 7.5,
    available: true
  }, {
    name: 'Pizza Margherita',
    category: 'Mains',
    price: 8.5,
    available: true
  }, {
    name: 'Falafel Wrap',
    category: 'Mains',
    price: 6.9,
    available: true
  }, {
    name: 'Lahmacun',
    category: 'Mains',
    price: 5.5,
    available: false
  }, {
    name: 'Pommes',
    category: 'Sides',
    price: 3.5,
    available: true
  }, {
    name: 'Ayran',
    category: 'Drinks',
    price: 1.8,
    available: true
  }, {
    name: 'Cola 0.5l',
    category: 'Drinks',
    price: 2.5,
    available: true
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/data.js", error: String((e && e.message) || e) }); }

__ds_ns.BrandLogo = __ds_scope.BrandLogo;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.PaymentBadge = __ds_scope.PaymentBadge;

__ds_ns.StatusBadge = __ds_scope.StatusBadge;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.QuoteBlock = __ds_scope.QuoteBlock;

__ds_ns.SectionLabel = __ds_scope.SectionLabel;

__ds_ns.StepCard = __ds_scope.StepCard;

__ds_ns.Card = __ds_scope.Card;

})();
