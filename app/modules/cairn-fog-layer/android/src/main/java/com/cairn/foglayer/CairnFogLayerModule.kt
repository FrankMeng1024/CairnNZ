// v303: Android implementation — STUB. Returns "not implemented" until
// the GLSL ES port is done in v304 (next sprint). The module still
// loads so JS API resolves without throwing; setMode("off") becomes the
// effective default on Android.
package expo.modules.cairnfoglayer

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CairnFogLayerModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("CairnFogLayer")

        AsyncFunction("addFogLayer") { reactTag: Int ->
            android.util.Log.i("CairnFog", "addFogLayer stub reactTag=$reactTag")
            // Resolve OK so JS doesn't error — fog just won't render on Android.
        }
        AsyncFunction("updateCircles") { _: Int, _: List<List<Double>> -> }
        AsyncFunction("setMode")       { _: Int, _: String -> }
        AsyncFunction("setFeather")    { _: Int, _: Double -> }
        AsyncFunction("setRipple")     { _: Int, _: Boolean -> }
        AsyncFunction("setFogColor")   { _: Int, _: Double, _: Double, _: Double, _: Double -> }
        AsyncFunction("removeFogLayer") { _: Int -> }
    }
}
