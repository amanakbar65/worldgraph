import { LayerExtension } from "@deck.gl/core";

/**
 * Hides billboarded marks (points, rings, labels) on the far side of the
 * globe. With the globe's depth test on, a billboard near the limb is cut in
 * half by the sphere; with it off, marks behind the planet show through. So
 * these layers skip the depth test and this test drops whole instances whose
 * anchor faces away from the camera instead.
 *
 * In deck.gl's globe projection, common space is a sphere of radius 256
 * centred at the origin, so a surface point P faces the camera C exactly when
 * dot(C, P) > dot(P, P).
 */
export class HorizonExtension extends LayerExtension {
  static extensionName = "HorizonExtension";

  getShaders() {
    return {
      inject: {
        "vs:#main-end": /* glsl */ `
          if (project.projectionMode == PROJECTION_MODE_GLOBE) {
            vec3 horizonAnchor = geometry.position.xyz;
            if (dot(project.cameraPosition, horizonAnchor) < dot(horizonAnchor, horizonAnchor)) {
              gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
            }
          }
        `,
      },
    };
  }
}
