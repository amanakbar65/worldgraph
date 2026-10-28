import { LayerExtension } from "@deck.gl/core";

import { ACTIVITY_ZOOM } from "./model";

const glsl = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/**
 * The glow's zoom fade in GLSL (sets `wgFade`, 0–1). Inlined in each hook:
 * hook functions are assembled before the shader's own declarations.
 */
function fadeGlsl(): string {
  const [in0, in1] = ACTIVITY_ZOOM.glowIn.map(glsl);
  const [out0, out1] = ACTIVITY_ZOOM.glowOut.map(glsl);
  return /* glsl */ `
    float wgZoom = log2(project.scale);
    if (project.projectionMode == PROJECTION_MODE_GLOBE) {
      vec3 wgCam = project.cameraPosition;
      float wgLat = asin(clamp(wgCam.z / max(length(wgCam), 1e-3), -1.0, 1.0));
      wgZoom += log2(PI * cos(clamp(wgLat, -1.4844222, 1.4844222)));
    }
    float wgFade = clamp((wgZoom - ${in0}) / (${in1} - ${in0}), 0.0, 1.0)
      * (1.0 - clamp((wgZoom - ${out0}) / (${out1} - ${out0}), 0.0, 1.0));
  `;
}

/**
 * Turns a ScatterplotLayer into a soft density glow (the "Activity" layer
 * when zoomed in):
 * - each point becomes a Gaussian puff that fades to nothing at its edge, so
 *   overlapping puffs build up smoothly where news clusters;
 * - the whole layer fades in and out with the zoom (ACTIVITY_ZOOM), worked
 *   out per vertex from the camera, so a zoom gesture fades it smoothly with
 *   no React state per frame. Where it is invisible, its points are moved
 *   off screen and cost nothing.
 *
 * deck.gl's HeatmapLayer can't do this here: it aggregates in a flat
 * texture, which deck.gl's globe projection doesn't support (it draws
 * nothing on the globe).
 *
 * The zoom matches MapLibre's: in globe view deck.gl's `project.scale` is
 * 2^zoom / (π·cos(latitude of the view's centre)), and with no pitch the
 * camera sits straight above that centre.
 */
export class GlowExtension extends LayerExtension {
  static extensionName = "GlowExtension";

  getShaders() {
    const fade = fadeGlsl();
    return {
      inject: {
        "vs:DECKGL_FILTER_COLOR": /* glsl */ `{
          ${fade}
          color.a *= wgFade;
        }`,
        "vs:#main-end": /* glsl */ `{
          ${fade}
          if (wgFade <= 0.0) {
            gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
          }
        }`,
        "fs:DECKGL_FILTER_COLOR": /* glsl */ `{
          float wgGlowR = length(geometry.uv);
          // A Gaussian that reaches exactly zero at the rim (no visible edge).
          color.a *= max(0.0, exp(-2.8 * wgGlowR * wgGlowR) - 0.0608 * wgGlowR);
        }`,
      },
    };
  }
}
