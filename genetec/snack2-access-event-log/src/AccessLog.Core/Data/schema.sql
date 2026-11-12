-- Access Event Log schema. Safe to run more than once: every object is created only if missing.

IF OBJECT_ID(N'dbo.Devices', N'U') IS NULL
CREATE TABLE dbo.Devices (
    Id       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Devices PRIMARY KEY,
    Name     NVARCHAR(100) NOT NULL,
    Kind     TINYINT       NOT NULL CONSTRAINT CK_Devices_Kind CHECK (Kind IN (0, 1)), -- 0 door, 1 camera
    Location NVARCHAR(100) NOT NULL
);

IF OBJECT_ID(N'dbo.Cardholders', N'U') IS NULL
CREATE TABLE dbo.Cardholders (
    Id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Cardholders PRIMARY KEY,
    Name        NVARCHAR(100) NOT NULL,
    BadgeNumber NVARCHAR(20)  NOT NULL CONSTRAINT UQ_Cardholders_Badge UNIQUE
);

IF OBJECT_ID(N'dbo.AccessEvents', N'U') IS NULL
CREATE TABLE dbo.AccessEvents (
    Id            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AccessEvents PRIMARY KEY,
    OccurredAtUtc DATETIME2(3)  NOT NULL,
    DeviceId      INT           NOT NULL CONSTRAINT FK_AccessEvents_Devices REFERENCES dbo.Devices (Id),
    CardholderId  INT           NULL     CONSTRAINT FK_AccessEvents_Cardholders REFERENCES dbo.Cardholders (Id),
    Kind          TINYINT       NOT NULL, -- 0 badge swipe, 1 status change
    Granted       BIT           NULL,     -- null for status changes
    Detail        NVARCHAR(200) NULL,
    -- A badge swipe always has a cardholder and a decision; a status change has neither.
    CONSTRAINT CK_AccessEvents_Shape CHECK (
        (Kind = 0 AND CardholderId IS NOT NULL AND Granted IS NOT NULL) OR
        (Kind = 1 AND CardholderId IS NULL AND Granted IS NULL))
);

-- Both reports filter on a time window and then group by device. Keyed on time, so "the last
-- 24 hours" is a range seek; DeviceId and Granted are included so the reports never touch the
-- table itself.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_AccessEvents_OccurredAt')
CREATE INDEX IX_AccessEvents_OccurredAt ON dbo.AccessEvents (OccurredAtUtc) INCLUDE (DeviceId, Granted, Kind);

-- The event list filtered to one device, newest first.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_AccessEvents_Device_OccurredAt')
CREATE INDEX IX_AccessEvents_Device_OccurredAt ON dbo.AccessEvents (DeviceId, OccurredAtUtc DESC);
