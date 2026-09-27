import ExpoModulesCore
import UIKit

public final class MusicInvertView: ExpoView {
  private var inverted = false

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
  }

  func setInverted(_ value: Bool) {
    if inverted == value {
      return
    }
    inverted = value
    applyInvert()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    applyInvert()
  }

  private func applyInvert() {
    backgroundColor = inverted ? .black : .clear
    layer.compositingFilter = nil
    applyInvertToLeafSubviews(in: self)
  }

  private func applyInvertToLeafSubviews(in view: UIView) {
    for subview in view.subviews {
      if subview.subviews.isEmpty {
        subview.layer.compositingFilter = inverted ? "CIColorInvert" : nil
      } else {
        subview.layer.compositingFilter = nil
        applyInvertToLeafSubviews(in: subview)
      }
    }
  }
}
