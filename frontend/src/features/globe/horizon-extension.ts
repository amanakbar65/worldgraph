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

/**
 * Fades lines (the cascade arcs) as they turn towards the horizon, so a link
 * that runs round to the far side melts away softly instead of hugging the
 * planet's rim like an orbit.
 *
 * `f` is how far a point sits inside the visible cap: 0 on the horizon, 1
 * right under the camera. It uses the direction of the point only, so raised
 * arcs fade like the ground beneath them, at every zoom.
 */
export class HorizonFadeExtension extends LayerExtension {
  static extensionName = "HorizonFadeExtension";

  getShaders() {
    return {
      inject: {
        "vs:DECKGL_FILTER_COLOR": /* glsl */ `
          if (project.projectionMode == PROJECTION_MODE_GLOBE) {
            vec3 fadeCamera = project.cameraPosition;
            float fadeCameraDistance = max(length(fadeCamera), 256.001);
            float fadeHorizon = 256.0 / fadeCameraDistance;
            float fadeAlong = dot(fadeCamera / fadeCameraDistance, normalize(geometry.position.xyz));
            float fadeInside = (fadeAlong - fadeHorizon) / max(1e-4, 1.0 - fadeHorizon);
            color.a *= smoothstep(0.04, 0.32, fadeInside);
          }
        `,
      },
    };
  }
}
