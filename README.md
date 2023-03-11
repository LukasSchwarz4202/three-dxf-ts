
# Three-Dxf-TS

**Three-Dxf-TS** takes dxf objects produced from Dxf-Parser and convertes them to three.js objects.


#### Requirements
Successfully tested with the following libraries:
  - "@dxfom/mtext": "^0.3.2"
  - "dxf-parser": "^1.1.2"
  - "three": "^0.148.0"
  - "troika-three-text": "^0.47.1"

To work with troika-three-text, which does not have type support, place devs.d.ts in the same folder as index.ts.

#### Usage
```javascript
// See dxf_to_three.ts for more details
const object3Ds = dxfToThreeObject3Ds(dxf, settings);
disposeObject3Ds(object3Ds);
```

#### Supported DXF Features
Supports:
* Most LW entities (lines, polylines, circles, etc)
* Layers
* Simple Text
* Splines
* Ellipses
* Text and MText (Basic multiline support available in v1.3.0 but not all formatting is supported)
 
Does not yet support:
* Attributes
* 3DSolids
* All types of Leaders
* other less common objects and entities.

