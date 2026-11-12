using System.Globalization;
using System.Windows.Data;
using System.Windows.Media;
using CameraMonitor.Core.Devices;

namespace CameraMonitor.App.Converters;

/// <summary>Device status to colour: green Online, grey Offline, red Alarm.</summary>
[ValueConversion(typeof(DeviceStatus), typeof(Brush))]
public sealed class StatusToBrushConverter : IValueConverter
{
    private static readonly Brush Online = Freeze(new SolidColorBrush(Color.FromRgb(0x2E, 0x9E, 0x4F)));
    private static readonly Brush Offline = Freeze(new SolidColorBrush(Color.FromRgb(0x8A, 0x93, 0x9B)));
    private static readonly Brush Alarm = Freeze(new SolidColorBrush(Color.FromRgb(0xD6, 0x33, 0x33)));

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value switch
        {
            DeviceStatus.Online => Online,
            DeviceStatus.Alarm => Alarm,
            _ => Offline,
        };

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException("Status colours are display-only.");

    // Frozen brushes are immutable, so every row can share one, from any thread.
    private static Brush Freeze(Brush brush)
    {
        brush.Freeze();
        return brush;
    }
}
