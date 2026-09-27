package expo.modules.pianopdfparser

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

@SuppressLint("ViewConstructor")
class MusicInvertView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private var inverted = false
  private val invertPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    colorFilter = ColorMatrixColorFilter(INVERT_MATRIX)
  }

  fun setInverted(value: Boolean) {
    if (inverted == value) {
      return
    }
    inverted = value
    applyInvert()
  }

  private fun applyInvert() {
    setBackgroundColor(if (inverted) Color.BLACK else Color.TRANSPARENT)
    invalidate()
  }

  override fun dispatchDraw(canvas: Canvas) {
    clipToPaddingBox(canvas)
    if (!inverted) {
      super.dispatchDraw(canvas)
      return
    }

    val saveCount = canvas.saveLayer(
      0f,
      0f,
      width.toFloat(),
      height.toFloat(),
      invertPaint,
    )
    super.dispatchDraw(canvas)
    canvas.restoreToCount(saveCount)
  }

  companion object {
    private val INVERT_MATRIX = ColorMatrix(
      floatArrayOf(
        -1f, 0f, 0f, 0f, 255f,
        0f, -1f, 0f, 0f, 255f,
        0f, 0f, -1f, 0f, 255f,
        0f, 0f, 0f, 1f, 0f,
      ),
    )
  }
}
