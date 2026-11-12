using System;
using System.Globalization;
using System.Windows.Data;
using System.Windows.Media;
using AccessLog.Core.Model;

namespace AccessLog.App.Converters;

/// <summary>Events are stored in UTC; show them in the computer's time zone.</summary>
[ValueConversion(typeof(DateTime), typeof(string))]
public sealed class UtcToLocalConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is DateTime utc
            ? DateTime.SpecifyKind(utc, DateTimeKind.Utc).ToLocalTime().ToString((parameter as string) ?? "yyyy-MM-dd HH:mm:ss", culture)
            : "";

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Granted green, denied red, status changes grey.</summary>
[ValueConversion(typeof(AccessEventView), typeof(Brush))]
public sealed class OutcomeToBrushConverter : IValueConverter
{
    private static readonly Brush Granted = Frozen(Color.FromRgb(0x2E, 0x9E, 0x4F));
    private static readonly Brush Denied = Frozen(Color.FromRgb(0xD6, 0x33, 0x33));
    private static readonly Brush Other = Frozen(Color.FromRgb(0x6B, 0x74, 0x7C));

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        (value as AccessEventView)?.Granted switch
        {
            true => Granted,
            false => Denied,
            _ => Other,
        };

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();

    private static Brush Frozen(Color color)
    {
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        return brush;
    }
}
