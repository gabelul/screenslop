import SwiftUI

struct SettingsFooter: View {
    var body: some View {
        Button(action: {}) {
            Image(systemName: "tray")
        }
        .accessibilityIdentifier("settings.saveButton")
    }
}
