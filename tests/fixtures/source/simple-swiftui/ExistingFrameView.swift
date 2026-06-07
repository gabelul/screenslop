import SwiftUI

struct ExistingFrameView: View {
    var body: some View {
        Button(action: {}) {
            Image(systemName: "checkmark")
        }
        .accessibilityIdentifier("settings.framedButton")
        .frame(minWidth: 44, minHeight: 44)
    }
}
