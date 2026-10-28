export type Easing = 1 | [number, number, number, number];

export type Keyframe = [offset: number, value: number | number[], easing?: Easing];

export type CompositedProperty = 'translate' | 'rotate' | 'scale' | 'transform' | 'opacity';

export type PaintProperty = 'fill' | 'stroke' | 'fillOpacity' | 'strokeOpacity' | 'strokeWidth';

export type TrackProperty = CompositedProperty | PaintProperty;

export interface Track {
  p: TrackProperty;
  k: Keyframe[];
}

export type Matrix = [number, number, number, number, number, number];

export interface NodeBase {
  t?: [number, number];
  r?: number;
  s?: [number, number];
  m?: Matrix;
  o?: number;
  bm?: string;
  clip?: [number, number];
  mask?: string;
  a?: Track[];
}

export interface DivNode extends NodeBase {
  k: 'div';
  c: SceneNode[];
}

export interface SvgNode extends NodeBase {
  k: 'svg';
  c: SvgItem[];
}

export interface ImageNode extends NodeBase {
  k: 'img';
  src: string;
  w: number;
  h: number;
}

export interface SolidNode extends NodeBase {
  k: 'solid';
  color: string;
  w: number;
  h: number;
}

export interface CanvasNode extends NodeBase {
  k: 'canvas';
  box: [x: number, y: number, w: number, h: number];
  c: SvgPath[];
}

export type SceneNode = DivNode | SvgNode | ImageNode | SolidNode | CanvasNode;

export interface Gradient {
  type: 'linear' | 'radial';
  p: number[];
  stops: [offset: number, color: string, opacity: number][];
}

export interface SvgGroup {
  g: SvgItem[];
  m?: Matrix;
  o?: number;
  bm?: string;
}

export interface SvgPath {
  d: string;
  fill?: string | Gradient;
  stroke?: string | Gradient;
  fo?: number;
  so?: number;
  sw?: number;
  lc?: 'butt' | 'round' | 'square';
  lj?: 'miter' | 'round' | 'bevel';
  ml?: number;
  dash?: number[];
  dashOffset?: number;
  rule?: 'evenodd';
  bm?: string;
  a?: Track[];
}

export type SvgItem = SvgGroup | SvgPath;

export interface Marker {
  name: string;
  frame: number;
  duration: number;
}

export interface LightieAnimation {
  lightie: 1;
  w: number;
  h: number;
  fr: number;
  ip: number;
  op: number;
  nodes: SceneNode[];
  markers?: Marker[];
  unsupported?: string[];
  source?: unknown;
}

export function isLightieAnimation(value: unknown): value is LightieAnimation {
  return typeof value === 'object' && value !== null && (value as { lightie?: unknown }).lightie === 1;
}
