import SwiftUI

public struct ContentView: View {
    @State private var saveCount = 0

    public init() {}

    public var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 8) {
                Text("RuntimeSmoke")
                    .font(.largeTitle.bold())
                    .accessibilityIdentifier("runtimeSmoke.title")

                Text("Live simulator proof for Screenslop")
                    .font(.body)
                    .foregroundStyle(.secondary)
            }

            Button(action: saveChanges) {
                Image(systemName: "tray.and.arrow.down.fill")
                    .font(.title2)
                    .accessibilityHidden(true)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityElement(children: .ignore)
            .accessibilityIdentifier("runtimeSmoke.saveButton")

            Text("Saved \(saveCount) time\(saveCount == 1 ? "" : "s")")
                .font(.callout.monospacedDigit())
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("runtimeSmoke.statusText")
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }

    private func saveChanges() {
        saveCount += 1
    }
}

#Preview {
    ContentView()
}
