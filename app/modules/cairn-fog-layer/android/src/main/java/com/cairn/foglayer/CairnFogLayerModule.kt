// Android implementation — STUB. iOS-only for the current sprint.
// The expo-module.config.json platforms array does NOT list "android",
// so this Kotlin file is NOT autolinked/compiled in the current build.
// It is retained as a placeholder for a future Android GLSL ES port,
// not as a scheduled commitment.
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
