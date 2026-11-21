// Stand-ins for the OCHA set. `#000000` because that is how OCHA ships, and
// the recolour path is what is under test. Inline keeps every page that draws a map network-free for icons.
export const ICON_SVGS: Record<string, string> = {
  "evt:strike": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 1l2.2 6.3L20 5l-3.2 5.4L23 12l-6.2 1.6L20 19l-5.8-2.3L12 23l-2.2-6.3L4 19l3.2-5.4L1 12l6.2-1.6L4 5l5.8 2.3z" fill="#000000"/></svg>`,
  "evt:fire": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2c1.5 4-2 5.5-2 9a4 4 0 008 0c0-2-1-3.5-2-5 .5 3-1 4-2 4s-2-1.5-2-3c0-2 1-3.5 2-5z" fill="#000000"/><path d="M8 12c-1 1.5-2 3-2 5a6 6 0 0012 0c0-1-.3-2-.8-3 .3 3.5-2.2 6-5.2 6s-5-2-4-8z" fill="#000000"/></svg>`,
  "evt:displaced": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="8" cy="4" r="2.2" fill="#000000"/><path d="M6 7h4l1.5 5-1.6.6L9 10v12H7V14H5V9z" fill="#000000"/><circle cx="16" cy="5" r="1.8" fill="#000000"/><path d="M14.5 8h3l1.5 4-1.4.6L17 11v11h-1.8v-7h-1.6v-6z" fill="#000000"/></svg>`,
  "evt:checkpoint": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2" y="10" width="20" height="4" fill="#000000"/><rect x="4" y="4" width="3" height="16" fill="#000000"/><rect x="17" y="4" width="3" height="16" fill="#000000"/></svg>`,
  "evt:aid": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="9.5" y="3" width="5" height="18" fill="#000000"/><rect x="3" y="9.5" width="18" height="5" fill="#000000"/></svg>`,
};
