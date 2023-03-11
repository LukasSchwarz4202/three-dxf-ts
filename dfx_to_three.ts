// This is based on the three-dxf library's (https://github.com/gdsestimating/three-dxf) file
// https://github.com/gdsestimating/three-dxf/blob/master/src/index.js
// Copyright (c) 2015 GDS Storefront Estimating
import { DxfMTextContentElement, parseDxfMTextContent } from "@dxfom/mtext";
import {
  IArcEntity,
  ICircleEntity,
  IDimensionEntity,
  IDxf,
  IEllipseEntity,
  IEntity,
  IInsertEntity,
  ILineEntity,
  ILineType,
  ILwpolylineEntity,
  IMtextEntity,
  IPoint,
  IPointEntity,
  IPolylineEntity,
  ISolidEntity,
  ISplineEntity,
  ITextEntity,
} from "dxf-parser";
import * as THREE from "three";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { Font, FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { Text } from "troika-three-text";

import bSpline from "./bspline";
import roboto from "./roboto_font/roboto_regular.typeface.json";

// constants
// -----------------------
const POINT_SIZE = 1;
const LINE_WIDTH = 1;
const DASHED_LINE_GAP_SIZE = 4;
const DASHED_LINE_DASH_SIZE = 4;
const DEFAULT_SCALE_FACTOR = 1.0;
const DEFAULT_REUSE_MATERIALS = true;
const DEFAULT_SET_ALL_ZS_TO_ZERO = true;
const DEFAULT_MAX_LENGTH_OF_ARC_LINE_SEGMENT = 100;
const DEFAULT_MAX_ANGLE_PER_ARC_LINE_SEGMENT = (15 * Math.PI) / 180.0;
const DEFAULT_INTERPOLATIONS_PER_SPLINE_SEGMENT = 100;

// settings interface
// ------------------------
export interface DxfToThreeSettings {
  // font to used for THREE.TextGeometry (default is Google Roboto)
  threeFont: undefined | Font;
  // font-url to use for troika-three-text (default is Google Roboto)
  troikaFontUrl: undefined | string;

  // scale factor used to scale all elements (default is 1.0)
  scaleFactor: undefined | number;
  // reuse materials: a cache for materials is used (default is true)
  // => pro:    improves performance
  // => contra: if changing parameter of material other Object3Ds
  //            are affected as well
  reuseMaterials: undefined | boolean;
  // make sure that all z-values of generated Object3Ds are zero (default is true)
  setAllZsToZero: undefined | boolean;

  // give all Object3Ds the same color (if not set use color of *.dxf)
  defaultColor: undefined | number;
  // certain material to use for points; texture (if not set use default THREE.PointsMaterial)
  defaultPointMaterial: undefined | THREE.PointsMaterial;
  // put all objects into the same layer (if undefined THREE-default is used)
  defaultLayer: undefined | number;

  // arc approximation: max length per arc segment (default is 100)
  maxLengthOfArcLineSegment: undefined | number;
  // arc approximation: max angle per arc segment (default is 15°)
  maxAnglePerArcLineSegment: undefined | number;
  // interpolations per spline segment (default is 100)
  interpolationsPerSplineSegment: undefined | number;
}

// basic helper functions
// ------------------------

const atan2d = (p1: IPoint | THREE.Vector2, p2: IPoint | THREE.Vector2): number => {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
};

const polar2d = (point: IPoint | THREE.Vector2, distance: number, angle: number): IPoint => {
  let result: IPoint = { x: 0.0, y: 0.0, z: 0.0 };
  result.x = point.x + distance * Math.cos(angle);
  result.y = point.y + distance * Math.sin(angle);
  return result;
};

const getBulgeCurvePoints2d = (
  startPoint: IPoint,
  endPoint: IPoint,
  scaleFactor: number = 1.0,
  bulge?: number,
  segmentsCount?: number
): THREE.Vector3[] => {
  const p0 = startPoint
    ? new THREE.Vector2(startPoint.x * scaleFactor, startPoint.y * scaleFactor)
    : new THREE.Vector2(0.0, 0.0);
  const p1 = endPoint
    ? new THREE.Vector2(endPoint.x * scaleFactor, endPoint.y * scaleFactor)
    : new THREE.Vector2(1.0, 0.0);
  if (bulge === undefined) bulge = 1.0;

  const angle = 4 * Math.atan(bulge);
  const radius = p0.distanceTo(p1) / 2 / Math.sin(angle / 2);
  const center = polar2d(p0, radius, atan2d(p0, p1) + (Math.PI / 2 - angle / 2));

  if (segmentsCount === undefined) {
    // By default want a segment roughly every 10 degrees
    segmentsCount = Math.max(Math.abs(Math.ceil(angle / (Math.PI / 18))), 6);
  }
  const startAngle = atan2d(center, p0);
  const thetaAngle = angle / segmentsCount;

  let vertices: THREE.Vector3[] = [];
  vertices.push(new THREE.Vector3(p0.x, p0.y, 0));
  for (let i = 1; i <= segmentsCount - 1; i++) {
    const vertex = polar2d(center, Math.abs(radius), startAngle + thetaAngle * i);
    vertices.push(new THREE.Vector3(vertex.x, vertex.y, 0.0));
  }

  return vertices;
};

// materials
// ------------------------

const getColor = (entity: IEntity, data: IDxf): number => {
  let color = 0x000000; // black is default
  if (entity.color) {
    color = entity.color;
  } else if (data.tables && data.tables.layer && data.tables.layer.layers[entity.layer])
    color = data.tables.layer.layers[entity.layer].color;

  if (color == null || color === 0xffffff) {
    color = 0x000000;
  }
  return color;
};

const CACHED_POINT_MATERIALS = new Map<number, THREE.PointsMaterial>();
const getPointMaterial = (entity: IEntity, data: IDxf, settings: DxfToThreeSettings): THREE.PointsMaterial => {
  const color = settings.defaultColor ? settings.defaultColor : getColor(entity, data);
  if (!settings.reuseMaterials) {
    if (settings.defaultPointMaterial === undefined) {
      return new THREE.PointsMaterial({ color: color, size: POINT_SIZE });
    } else {
      const newPointMaterial = settings.defaultPointMaterial.clone();
      newPointMaterial.color = new THREE.Color(color);
      newPointMaterial.needsUpdate = true;
      return newPointMaterial;
    }
  } else if (CACHED_POINT_MATERIALS.has(color)) {
    return CACHED_POINT_MATERIALS.get(color)!;
  } else {
    if (settings.defaultPointMaterial === undefined) {
      const newPointMaterial = new THREE.PointsMaterial({
        color: color,
        size: POINT_SIZE,
      });
      CACHED_POINT_MATERIALS.set(color, newPointMaterial);
      return newPointMaterial;
    } else {
      const newPointMaterial = settings.defaultPointMaterial.clone();
      newPointMaterial.color = new THREE.Color(color);
      newPointMaterial.needsUpdate = true;
      CACHED_POINT_MATERIALS.set(color, newPointMaterial);
      return newPointMaterial;
    }
  }
};

const CACHED_LINE_MATERIALS = new Map<number, THREE.LineBasicMaterial>();
const CACHED_DASHED_LINE_MATERIALS = new Map<number, THREE.LineDashedMaterial>();
const getLineMaterial = (
  entity: IEntity,
  data: IDxf,
  settings: DxfToThreeSettings
): THREE.LineBasicMaterial | THREE.LineDashedMaterial => {
  const color = settings.defaultColor ? settings.defaultColor : getColor(entity, data);
  let lineType: ILineType | undefined = undefined;
  if (entity.lineType) {
    lineType = data.tables.lineType.lineTypes[entity.lineType];
  }
  if (lineType && lineType.pattern && lineType.pattern.length !== 0) {
    if (!settings.reuseMaterials) {
      return new THREE.LineDashedMaterial({
        color: color,
        linewidth: LINE_WIDTH,
        gapSize: DASHED_LINE_GAP_SIZE,
        dashSize: DASHED_LINE_DASH_SIZE,
      });
    } else if (CACHED_DASHED_LINE_MATERIALS.has(color)) {
      return CACHED_DASHED_LINE_MATERIALS.get(color)!;
    } else {
      const newLineMaterial = new THREE.LineDashedMaterial({
        color: color,
        linewidth: LINE_WIDTH,
        gapSize: DASHED_LINE_GAP_SIZE,
        dashSize: DASHED_LINE_DASH_SIZE,
      });
      CACHED_DASHED_LINE_MATERIALS.set(color, newLineMaterial);
      return newLineMaterial;
    }
  } else {
    if (!settings.reuseMaterials) {
      return new THREE.LineBasicMaterial({
        color: color,
        linewidth: LINE_WIDTH,
      });
    } else if (CACHED_LINE_MATERIALS.has(color)) {
      return CACHED_LINE_MATERIALS.get(color)!;
    } else {
      const newLineMaterial = new THREE.LineBasicMaterial({
        color: color,
        linewidth: LINE_WIDTH,
      });
      CACHED_LINE_MATERIALS.set(color, newLineMaterial);
      return newLineMaterial;
    }
  }
};

const CACHED_MESH_MATERIALS = new Map<number, THREE.MeshBasicMaterial>();
const getMeshMaterial = (entity: IEntity, data: IDxf, settings: DxfToThreeSettings): THREE.MeshBasicMaterial => {
  const color = settings.defaultColor ? settings.defaultColor : getColor(entity, data);
  if (!settings.reuseMaterials) {
    return new THREE.MeshBasicMaterial({ color: color });
  } else if (CACHED_MESH_MATERIALS.has(color)) {
    return CACHED_MESH_MATERIALS.get(color)!;
  } else {
    const newMeshMaterial = new THREE.MeshBasicMaterial({ color: color });
    CACHED_MESH_MATERIALS.set(color, newMeshMaterial);
    return newMeshMaterial;
  }
};

export const disposeCachedMaterials = (): void => {
  CACHED_POINT_MATERIALS.forEach((material) => material.dispose());
  CACHED_LINE_MATERIALS.forEach((material) => material.dispose());
  CACHED_DASHED_LINE_MATERIALS.forEach((material) => material.dispose());
  CACHED_MESH_MATERIALS.forEach((material) => material.dispose());
};

// get geometries
// ------------------------

const getPoint = (entity: IPointEntity, data: IDxf, settings: DxfToThreeSettings): THREE.Points => {
  const geometry = new THREE.BufferGeometry();
  const scaleFactor = settings.scaleFactor!;
  const setAllZsToZero = settings.setAllZsToZero!;
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        entity.position.x * scaleFactor,
        entity.position.y * scaleFactor,
        (setAllZsToZero ? 0.0 : entity.position.z || 0.0) * scaleFactor,
      ],
      3
    )
  );
  const material = getPointMaterial(entity, data, settings);
  return new THREE.Points(geometry, material);
};

const getLine = (entity: ILineEntity, data: IDxf, settings: DxfToThreeSettings): THREE.Line => {
  if (!entity.vertices) {
    console.log("entity missing vertices.");
  }

  // create geometry
  const scaleFactor = settings.scaleFactor!;
  const points = entity.vertices.map(
    (vertex) => new THREE.Vector3(vertex.x * scaleFactor, vertex.y * scaleFactor, 0.0)
  );

  // return line
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = getLineMaterial(entity, data, settings);
  return new THREE.Line(geometry, material);
};

const getPolyLine = (
  entity: ILwpolylineEntity | IPolylineEntity,
  data: IDxf,
  settings: DxfToThreeSettings
): THREE.Line => {
  if (!entity.vertices) {
    console.log("entity missing vertices.");
  }

  // create geometry
  const scaleFactor = settings.scaleFactor!;
  let points: THREE.Vector3[] = [];
  for (let i = 0; i < entity.vertices.length; i++) {
    if (entity.vertices[i].bulge !== undefined && entity.vertices[i].bulge !== 0.0) {
      const bulge = entity.vertices[i].bulge;
      const startPoint = entity.vertices[i];
      const endPoint = i + 1 < entity.vertices.length ? entity.vertices[i + 1] : points[0];
      const bulgePoints = getBulgeCurvePoints2d(startPoint, endPoint, scaleFactor, bulge);
      points.push.apply(points, bulgePoints);
    } else {
      const vertex = entity.vertices[i];
      points.push(new THREE.Vector3(vertex.x * scaleFactor, vertex.y * scaleFactor, 0.0));
    }
  }
  if (entity.shape) {
    points.push(points[0]);
  }

  // return polygon
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = getLineMaterial(entity, data, settings);
  return new THREE.Line(geometry, material);
};

const getArc = (entity: IArcEntity | ICircleEntity, data: IDxf, settings: DxfToThreeSettings): THREE.Line => {
  // create geometry
  let startAngle: number = 0.0;
  let endAngle: number = 0.0;
  if (entity.type === "CIRCLE") {
    startAngle = entity.startAngle || 0;
    endAngle = startAngle + 2 * Math.PI;
  } else {
    startAngle = entity.startAngle;
    endAngle = entity.endAngle;
  }

  const curve = new THREE.ArcCurve(
    entity.center.x * settings.scaleFactor!,
    entity.center.y * settings.scaleFactor!,
    entity.radius * settings.scaleFactor!,
    startAngle,
    endAngle,
    false
  ); // Always mathematical positive (= counterclockwise)

  // find out how many segments to to split curve to
  const arcLength = curve.getLength();
  const radialArcLength = arcLength / entity.radius;
  const numberOfPointsCondition1 =
    Math.ceil(arcLength / (settings.maxLengthOfArcLineSegment! * settings.scaleFactor!)) + 1;
  const numberOfPointsCondition2 = Math.ceil(radialArcLength / settings.maxAnglePerArcLineSegment!) + 1;
  const numberOfPoints =
    numberOfPointsCondition1 > numberOfPointsCondition2 ? numberOfPointsCondition1 : numberOfPointsCondition2;

  // return arc
  const points = curve.getPoints(numberOfPoints);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = getLineMaterial(entity, data, settings);
  return new THREE.Line(geometry, material);
};

const getEllipse = (entity: IEllipseEntity, data: IDxf, settings: DxfToThreeSettings): THREE.Line => {
  const xrad = Math.sqrt(Math.pow(entity.majorAxisEndPoint.x, 2) + Math.pow(entity.majorAxisEndPoint.y, 2));
  const yrad = xrad * entity.axisRatio;
  const rotation = Math.atan2(entity.majorAxisEndPoint.y, entity.majorAxisEndPoint.x);

  const curve = new THREE.EllipseCurve(
    entity.center.x * settings.scaleFactor!,
    entity.center.y * settings.scaleFactor!,
    xrad,
    yrad,
    entity.startAngle,
    entity.endAngle,
    false, // Always mathematical positive (= counterclockwise)
    rotation
  );

  // find out how many segments to to split curve to
  const arcLength = curve.getLength();
  const radialArcLength = arcLength / Math.min(xrad, yrad);
  const numberOfPointsCondition1 =
    Math.ceil(arcLength / (settings.maxLengthOfArcLineSegment! * settings.scaleFactor!)) + 1;
  const numberOfPointsCondition2 = Math.ceil(radialArcLength / settings.maxAnglePerArcLineSegment!) + 1;
  const numberOfPoints =
    numberOfPointsCondition1 > numberOfPointsCondition2 ? numberOfPointsCondition1 : numberOfPointsCondition2;

  // return ellipse
  const points = curve.getPoints(numberOfPoints);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = getLineMaterial(entity, data, settings);
  return new THREE.Line(geometry, material);
};

const getBSplinePolyline2D = (
  controlPoints: IPoint[],
  degree: number,
  knots: number[],
  interpolationsPerSplineSegment: number,
  scaleFactor: number = 1.0,
  weights?: number[]
): THREE.Vector2[] => {
  const polyline: THREE.Vector2[] = [];
  const controlPointsForLib = controlPoints.map((p) => {
    return [p.x * scaleFactor, p.y * scaleFactor];
  });

  const segmentTs = [knots[degree]];
  const domain = [knots[degree], knots[knots.length - 1 - degree]];

  for (let k = degree + 1; k < knots.length - degree; ++k) {
    if (segmentTs[segmentTs.length - 1] !== knots[k]) {
      segmentTs.push(knots[k]);
    }
  }

  for (let i = 1; i < segmentTs.length; ++i) {
    const uMin = segmentTs[i - 1];
    const uMax = segmentTs[i];
    for (let k = 0; k <= interpolationsPerSplineSegment; ++k) {
      const u = (k / interpolationsPerSplineSegment) * (uMax - uMin) + uMin;
      // Clamp t to 0, 1 to handle numerical precision issues
      let t = (u - domain[0]) / (domain[1] - domain[0]);
      t = Math.max(t, 0);
      t = Math.min(t, 1);
      const p = bSpline(t, degree, controlPointsForLib, knots, weights);
      polyline.push(new THREE.Vector2(p[0], p[1]));
    }
  }
  return polyline;
};

const getSpline = (entity: ISplineEntity, data: IDxf, settings: DxfToThreeSettings): THREE.Line => {
  const points = getBSplinePolyline2D(
    entity.controlPoints!,
    entity.degreeOfSplineCurve,
    entity.knotValues,
    settings.interpolationsPerSplineSegment!,
    settings.scaleFactor
  );
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = getLineMaterial(entity, data, settings);
  return new THREE.Line(geometry, material);
};

// draw texts
// ------------------------

const getText = (entity: ITextEntity, data: IDxf, settings: DxfToThreeSettings): THREE.Mesh => {
  const scaleFactor = settings.scaleFactor!;
  const geometry = new TextGeometry(entity.text, {
    font: settings.threeFont!,
    height: 0,
    size: (entity.textHeight || 12) * scaleFactor,
  });
  if (entity.rotation) {
    geometry.rotateZ((entity.rotation * Math.PI) / 180);
  }
  const material = getMeshMaterial(entity, data, settings);
  const text = new THREE.Mesh(geometry, material);
  text.position.x = entity.startPoint.x * scaleFactor;
  text.position.y = entity.startPoint.y * scaleFactor;
  text.position.z = (settings.setAllZsToZero ? 0.0 : entity.startPoint.z || 0.0) * scaleFactor;
  return text;
};

const mtextContentAndFormattingToTextAndStyle = (
  textAndControlChars: DxfMTextContentElement[],
  entity: IMtextEntity
): {
  text: string;
  style: {
    horizontalAlignment: string;
    textHeight: number;
  };
} => {
  let activeStyle = {
    horizontalAlignment: "left",
    textHeight: entity.height,
  };

  const text = [];
  for (let item of textAndControlChars) {
    if (typeof item === "string") {
      if (item.startsWith("pxq") && item.endsWith(";")) {
        if (item.indexOf("c") !== -1) activeStyle.horizontalAlignment = "center";
        else if (item.indexOf("l") !== -1) activeStyle.horizontalAlignment = "left";
        else if (item.indexOf("r") !== -1) activeStyle.horizontalAlignment = "right";
        else if (item.indexOf("j") !== -1) activeStyle.horizontalAlignment = "justify";
      } else {
        text.push(item);
      }
    } else if (Array.isArray(item)) {
      const nestedFormat = mtextContentAndFormattingToTextAndStyle(item, entity);
      text.push(nestedFormat.text);
    } else if (typeof item === "object") {
      if (item["S"] && item["S"].length === 3) {
        text.push(item["S"][0] + "/" + item["S"][2]);
      } else {
        // not yet supported.
      }
    }
  }
  return {
    text: text.join(),
    style: activeStyle,
  };
};

const createTextForScene = (
  text: string,
  style: { horizontalAlignment: string; textHeight: number },
  entity: IMtextEntity,
  data: IDxf,
  settings: DxfToThreeSettings
): THREE.Mesh | null => {
  if (text.length === 0) {
    console.log("text of entity is empty => ignoring it");
    return null;
  }

  const textEnt = new Text();
  textEnt.text = text.replaceAll("\\P", "\n").replaceAll("\\X", "\n");

  const scaleFactor = settings.scaleFactor!;
  if (settings.troikaFontUrl !== undefined) {
    textEnt.font = settings.troikaFontUrl;
  }
  textEnt.fontSize = style.textHeight * scaleFactor;
  textEnt.maxWidth = entity.width * scaleFactor;
  textEnt.position.x = entity.position.x * scaleFactor;
  textEnt.position.y = entity.position.y * scaleFactor;
  textEnt.position.z = (settings.setAllZsToZero ? 0.0 : entity.position.z || 0.0) * scaleFactor;
  textEnt.textAlign = style.horizontalAlignment;
  textEnt.material = getMeshMaterial(entity, data, settings);
  if (entity.rotation) {
    textEnt.rotation.z = (entity.rotation * Math.PI) / 180;
  }
  if (entity.directionVector) {
    const dv = entity.directionVector;
    textEnt.rotation.z = new THREE.Vector3(1, 0, 0).angleTo(new THREE.Vector3(dv.x, dv.y, dv.z));
  }
  switch (entity.attachmentPoint) {
    case 1:
      // Top Left
      textEnt.anchorX = "left";
      textEnt.anchorY = "top";
      break;
    case 2:
      // Top Center
      textEnt.anchorX = "center";
      textEnt.anchorY = "top";
      break;
    case 3:
      // Top Right
      textEnt.anchorX = "right";
      textEnt.anchorY = "top";
      break;

    case 4:
      // Middle Left
      textEnt.anchorX = "left";
      textEnt.anchorY = "middle";
      break;
    case 5:
      // Middle Center
      textEnt.anchorX = "center";
      textEnt.anchorY = "middle";
      break;
    case 6:
      // Middle Right
      textEnt.anchorX = "right";
      textEnt.anchorY = "middle";
      break;

    case 7:
      // Bottom Left
      textEnt.anchorX = "left";
      textEnt.anchorY = "bottom";
      break;
    case 8:
      // Bottom Center
      textEnt.anchorX = "center";
      textEnt.anchorY = "bottom";
      break;
    case 9:
      // Bottom Right
      textEnt.anchorX = "right";
      textEnt.anchorY = "bottom";
      break;

    default:
      console.log("unknown attachment point for text => ignoring it");
      return null;
  }

  textEnt.sync(() => {
    if (textEnt.textAlign !== "left") {
      textEnt.geometry.computeBoundingBox();
      const textWidth = textEnt.geometry.boundingBox.max.x - textEnt.geometry.boundingBox.min.x;
      if (textEnt.textAlign === "center") {
        textEnt.position.x += (entity.width * scaleFactor - textWidth) / 2.0;
      }
      if (textEnt.textAlign === "right") {
        textEnt.position.x += entity.width * scaleFactor - textWidth;
      }
    }
  });

  return textEnt;
};

const getMtext = (entity: IMtextEntity, data: IDxf, settings: DxfToThreeSettings): THREE.Mesh | null => {
  //Note: We currently only support a single format applied to all the mtext text
  let textAndControlChars = parseDxfMTextContent(entity.text);
  if (textAndControlChars.length > 0 && typeof textAndControlChars.at(0)! === "string") {
    const firstItem = textAndControlChars.at(0) as string;
    if (
      firstItem.startsWith("pxqc;") ||
      firstItem.startsWith("pxql;") ||
      firstItem.startsWith("pxqr;") ||
      firstItem.startsWith("pxqj;")
    ) {
      textAndControlChars = [];
      textAndControlChars.push(firstItem.substring(0, 5));
      textAndControlChars.push(firstItem.substring(5));
    }
  }
  const content = mtextContentAndFormattingToTextAndStyle(textAndControlChars, entity);
  return createTextForScene(content.text, content.style, entity, data, settings);
};

const addTriangleFacingCamera = (
  verts: THREE.Vector3[],
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3
): void => {
  // Calculate which direction the points are facing (clockwise or counter-clockwise)
  var vector1 = new THREE.Vector3();
  var vector2 = new THREE.Vector3();
  vector1.subVectors(p1, p0);
  vector2.subVectors(p2, p0);
  vector1.cross(vector2);

  var v0 = new THREE.Vector3(p0.x, p0.y, p0.z);
  var v1 = new THREE.Vector3(p1.x, p1.y, p1.z);
  var v2 = new THREE.Vector3(p2.x, p2.y, p2.z);

  // If z < 0 then we must draw these in reverse order
  if (vector1.z < 0) {
    verts.push(v2, v1, v0);
  } else verts.push(v0, v1, v2);
};

const getSolid = (entity: ISolidEntity, data: IDxf, settings: DxfToThreeSettings): THREE.Mesh => {
  const geometry = new THREE.BufferGeometry();
  const scaleFactor = settings.scaleFactor!;
  const setAllZsToZero = settings.setAllZsToZero!;
  var points = entity.points;
  // verts = geometry.vertices;
  const verts: THREE.Vector3[] = [];
  const point0 = new THREE.Vector3(
    points[0].x * scaleFactor,
    points[0].y * scaleFactor,
    (setAllZsToZero ? 0.0 : points[0].z || 0.0) * scaleFactor
  );
  const point1 = new THREE.Vector3(
    points[1].x * scaleFactor,
    points[1].y * scaleFactor,
    (setAllZsToZero ? 0.0 : points[1].z || 0.0) * scaleFactor
  );
  const point2 = new THREE.Vector3(
    points[2].x * scaleFactor,
    points[2].y * scaleFactor,
    (setAllZsToZero ? 0.0 : points[2].z || 0.0) * scaleFactor
  );
  addTriangleFacingCamera(verts, point0, point1, point2);
  if (points.length > 3) {
    const point3 = new THREE.Vector3(
      points[3].x * scaleFactor,
      points[3].y * scaleFactor,
      (setAllZsToZero ? 0.0 : points[3].z || 0.0) * scaleFactor
    );
    addTriangleFacingCamera(verts, point1, point2, point3);
  }
  geometry.setFromPoints(verts);
  const material = getMeshMaterial(entity, data, settings);
  return new THREE.Mesh(geometry, material);
};

const getBlock = (entity: IInsertEntity, data: IDxf, settings: DxfToThreeSettings): THREE.Group | null => {
  const block = data.blocks[entity.name];
  if (!block.entities) {
    return null;
  }

  const group = new THREE.Group();
  if (entity.xScale) {
    group.scale.x = entity.xScale;
  }
  if (entity.yScale) {
    group.scale.y = entity.yScale;
  }
  if (entity.rotation) {
    group.rotation.z = (entity.rotation * Math.PI) / 180;
  }
  const scaleFactor = settings.scaleFactor!;
  const setAllZsToZero = settings.setAllZsToZero!;
  if (entity.position) {
    group.position.x = entity.position.x * scaleFactor;
    group.position.y = entity.position.y * scaleFactor;
    group.position.z = (setAllZsToZero ? 0.0 : entity.position.z || 0.0) * scaleFactor;
  }

  for (let i = 0; i < block.entities.length; i++) {
    const childEntity = getGeometry(block.entities[i], data, settings);
    if (childEntity) {
      group.add(childEntity);
    }
  }
  return group;
};

const getDimension = (entity: IDimensionEntity, data: IDxf, settings: DxfToThreeSettings): THREE.Group | null => {
  const block = data.blocks[entity.block];
  if (!block || !block.entities) {
    return null;
  }

  const group = new THREE.Group();
  // const scaleFactor = settings.scaleFactor;
  // const setAllZsToZero = settings.setAllZsToZero;
  // if (entity.anchorPoint) {
  //     group.position.x = entity.anchorPoint.x * scaleFactor;
  //     group.position.y = entity.anchorPoint.y * scaleFactor;
  //     group.position.z = (setAllZsToZero ? 0.0 : entity.anchorPoint.z || 0.0) * scaleFactor;
  // }

  for (let i = 0; i < block.entities.length; i++) {
    const childEntity = getGeometry(block.entities[i], data, settings);
    if (childEntity) {
      group.add(childEntity);
    }
  }
  return group;
};

// get geometry for entity
// ------------------------

const getGeometry = (
  entity: IEntity,
  data: IDxf,
  settings: DxfToThreeSettings
): THREE.Points | THREE.Line | THREE.Mesh | THREE.Group | null => {
  if (entity.type === "POINT") {
    return getPoint(entity as IPointEntity, data, settings);
  } else if (entity.type === "LINE" || entity.type === "POLYLINE") {
    return getLine(entity as ILineEntity, data, settings);
  } else if (entity.type === "POLYLINE") {
    return getPolyLine(entity as IPolylineEntity, data, settings);
  } else if (entity.type === "LWPOLYLINE") {
    return getPolyLine(entity as ILwpolylineEntity, data, settings);
  } else if (entity.type === "ARC") {
    return getArc(entity as IArcEntity, data, settings);
  } else if (entity.type === "CIRCLE") {
    return getArc(entity as ICircleEntity, data, settings);
  } else if (entity.type === "ELLIPSE") {
    return getEllipse(entity as IEllipseEntity, data, settings);
  } else if (entity.type === "SPLINE") {
    return getSpline(entity as ISplineEntity, data, settings);
  } else if (entity.type === "TEXT") {
    return getText(entity as ITextEntity, data, settings);
  } else if (entity.type === "MTEXT") {
    return getMtext(entity as IMtextEntity, data, settings);
  } else if (entity.type === "SOLID") {
    return getSolid(entity as ISolidEntity, data, settings);
  } else if (entity.type === "INSERT") {
    return getBlock(entity as IInsertEntity, data, settings);
  } else if (entity.type === "DIMENSION") {
    const dimTypeEnum = (entity as IDimensionEntity).dimensionType & 7;
    if (dimTypeEnum === 0) {
      return getDimension(entity as IDimensionEntity, data, settings);
    } else {
      console.log("Unsupported Dimension type: " + dimTypeEnum);
      return null;
    }
  } else {
    console.log("Unsupported Entity Type: " + entity.type);
    return null;
  }
};

// convert all entities to THREE.Object3Ds
// ------------------------

const setLayerTo = (object3D: THREE.Object3D, layer: number) => {
  object3D.layers = new THREE.Layers();
  object3D.layers.set(layer);
  object3D.children.forEach((child) => setLayerTo(child, layer));
};

export const dxfToThreeObject3Ds = (
  data: IDxf,
  settings: undefined | DxfToThreeSettings
): (THREE.Points | THREE.Line | THREE.Mesh | THREE.Group)[] => {
  // initialize default settings
  if (settings === undefined) {
    settings = {
      threeFont: new FontLoader().parse(roboto),
      troikaFontUrl: undefined,
      scaleFactor: DEFAULT_SCALE_FACTOR,
      reuseMaterials: DEFAULT_REUSE_MATERIALS,
      setAllZsToZero: DEFAULT_SET_ALL_ZS_TO_ZERO,
      defaultColor: undefined,
      defaultPointMaterial: undefined,
      defaultLayer: undefined,
      maxLengthOfArcLineSegment: DEFAULT_MAX_LENGTH_OF_ARC_LINE_SEGMENT,
      maxAnglePerArcLineSegment: DEFAULT_MAX_ANGLE_PER_ARC_LINE_SEGMENT,
      interpolationsPerSplineSegment: DEFAULT_INTERPOLATIONS_PER_SPLINE_SEGMENT,
    };
  } else if (settings.threeFont === undefined) {
    settings.threeFont = new FontLoader().parse(roboto);
  } else if (settings.scaleFactor === undefined) {
    settings.scaleFactor = DEFAULT_SCALE_FACTOR;
  } else if (settings.reuseMaterials === undefined) {
    settings.reuseMaterials = DEFAULT_REUSE_MATERIALS;
  } else if (settings.setAllZsToZero === undefined) {
    settings.setAllZsToZero = DEFAULT_SET_ALL_ZS_TO_ZERO;
  } else if (settings.maxLengthOfArcLineSegment === undefined) {
    settings.maxLengthOfArcLineSegment = DEFAULT_MAX_LENGTH_OF_ARC_LINE_SEGMENT;
  } else if (settings.maxAnglePerArcLineSegment === undefined) {
    settings.maxLengthOfArcLineSegment = DEFAULT_MAX_ANGLE_PER_ARC_LINE_SEGMENT;
  } else if (settings.maxAnglePerArcLineSegment === undefined) {
    settings.maxLengthOfArcLineSegment = DEFAULT_INTERPOLATIONS_PER_SPLINE_SEGMENT;
  }

  // create Object3Ds
  const threeObject3Ds: (THREE.Points | THREE.Line | THREE.Mesh | THREE.Group)[] = [];
  for (let i = 0; i < data.entities.length; i++) {
    const entity = data.entities[i];
    const object3D = getGeometry(entity, data, settings);
    if (object3D) {
      if (settings.defaultLayer !== undefined) {
        setLayerTo(object3D, settings.defaultLayer);
      }
      threeObject3Ds.push(object3D);
    }
  }
  return threeObject3Ds;
};

const disposeObject3D = (object3D: THREE.Object3D): void => {
  if (object3D instanceof THREE.Points || object3D instanceof THREE.Line || object3D instanceof THREE.Mesh) {
    object3D.geometry.dispose();
    object3D.material.dispose();
  } else if (object3D instanceof THREE.Group) {
    object3D.children.forEach((object3D) => disposeObject3D(object3D));
  }
};

export const disposeObject3Ds = (object3Ds: (THREE.Points | THREE.Line | THREE.Mesh | THREE.Group)[]): void => {
  object3Ds.forEach((object3D) => disposeObject3D(object3D));
};
