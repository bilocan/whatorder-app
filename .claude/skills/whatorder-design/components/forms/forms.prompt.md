Form controls. `Input` adapts to `light` (dashboard) or `dark` (marketing) surfaces and tints its border on focus. `Select` is the compact dashboard dropdown with a custom chevron.

```jsx
<Input surface="light" label="Phone number" placeholder="+43 660 123 4567" />
<Input surface="dark" placeholder="e.g. Kebap & Pizza Favoriten" />
<Select
  ariaLabel="Show"
  value={filter}
  onChange={e => setFilter(e.target.value)}
  options={[{value:'active',label:'Active orders'},{value:'done',label:'Completed'}]}
/>
```
