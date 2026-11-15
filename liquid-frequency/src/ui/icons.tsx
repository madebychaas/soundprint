import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({ width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p });

export const IconSound = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M4 10v4h3l4 3.5v-11L7 10H4z" /><path d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.8a7.4 7.4 0 0 1 0 10.4" /></svg>);
export const IconMute = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M4 10v4h3l4 3.5v-11L7 10H4z" /><path d="M15.5 9.5l5 5M20.5 9.5l-5 5" /></svg>);
export const IconSettings = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M4 7h10M18 7h2M4 12h3M11 12h9M4 17h9M17 17h3" /><circle cx="16" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="15" cy="17" r="2" /></svg>);
export const IconReset = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5" /><path d="M4 4.5v3.6h3.6" /></svg>);
export const IconArrow = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M5 12h14M13.5 6.5L19 12l-5.5 5.5" /></svg>);
export const IconBack = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M19 12H5M10.5 6.5L5 12l5.5 5.5" /></svg>);
export const IconClose = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>);
export const IconChevron = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M6 9.5l6 6 6-6" /></svg>);
export const IconSpec = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" /></svg>);
export const IconCompare = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M12 3.5v17M5 7.5h4.5M5 12h4.5M5 16.5h4.5M14.5 7.5H19M14.5 12H19M14.5 16.5H19" /></svg>);
export const IconGallery = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><circle cx="6.5" cy="12" r="2.6" /><circle cx="12" cy="12" r="3.6" /><circle cx="17.8" cy="12" r="2.2" /></svg>);
