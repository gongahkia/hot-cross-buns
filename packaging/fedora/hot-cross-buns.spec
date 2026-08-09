Name:           hot-cross-buns
Version:        6.0.0
Release:        1%{?dist}
Summary:        Keyboard-first planner for Google Tasks and Google Calendar
License:        LicenseRef-UNLICENSED
URL:            https://github.com/gongahkia/hot-cross-buns
Source0:        %{name}-%{version}.tar.gz

BuildRequires:  cmake >= 3.28
BuildRequires:  cmake-rpm-macros
BuildRequires:  gcc-c++
BuildRequires:  ninja-build
BuildRequires:  qt6-qtbase-devel >= 6.10
BuildRequires:  qt6-qtdeclarative-devel >= 6.10
BuildRequires:  qt6-qtwayland
BuildRequires:  sqlite-devel >= 3.50
BuildRequires:  systemd-rpm-macros

Requires:       qt6-qtbase >= 6.10
Requires:       qt6-qtdeclarative >= 6.10
Requires:       qt6-qtwayland
Requires:       sqlite-libs >= 3.50
Requires:       systemd

%description
Hot Cross Buns is a native Qt desktop client for Google Calendar and Google
Tasks. It keeps an offline SQLite cache and syncs through a user-owned Google
Desktop OAuth client.

%prep
%autosetup

%build
%cmake -G Ninja \
  -DHCB_NATIVE_DEPENDENCY_MODE=system \
  -DHCB_ENABLE_FEDORA_RPM=ON \
  -DCMAKE_BUILD_TYPE=Release
%cmake_build

%install
%cmake_install

%check
QT_QPA_PLATFORM=offscreen ctest --test-dir build --output-on-failure

%files
%{_bindir}/hot-cross-buns
%{_libexecdir}/hot-cross-buns/hcb-reminderd
%{_datadir}/applications/hot-cross-buns.desktop
%{_datadir}/icons/hicolor/1024x1024/apps/hot-cross-buns.png
%{_userunitdir}/hcb-reminderd.service

%changelog
* Sun Aug 09 2026 Hot Cross Buns maintainers <maintainers@invalid> - 6.0.0-1
- Initial Fedora 43 KDE/Wayland RPM
