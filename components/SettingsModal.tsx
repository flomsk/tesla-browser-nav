"use client";

import { APP_DESCRIPTION, APP_NAME } from "@/lib/brand";
import { useState, useEffect } from "react";
import posthog from "posthog-js";
import { ShieldExclamationIcon, MapIcon } from "@heroicons/react/24/solid";
import { policeAlertDistanceOptions } from "@/lib/units";
import { NAV_LANGUAGES } from "@/lib/navLanguage";
import type { UnitSystem } from "@/lib/units";
import type { NavLanguage } from "@/lib/navLanguage";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  showWazeAlerts: boolean;
  onToggleWazeAlerts: (value: boolean) => void;
  showSpeedCameras: boolean;
  onToggleSpeedCameras: (value: boolean) => void;
  showTraffic: boolean;
  onToggleTraffic: (value: boolean) => void;
  useSatellite: boolean;
  onToggleSatellite: (value: boolean) => void;
  showAvatarPulse: boolean;
  onToggleAvatarPulse: (value: boolean) => void;
  // Police alert settings
  policeAlertDistance: number;
  onPoliceAlertDistanceChange: (value: number) => void;
  policeAlertSound: boolean;
  onTogglePoliceAlertSound: (value: boolean) => void;
  // 3D mode settings
  use3DMode: boolean;
  onToggle3DMode: (value: boolean) => void;
  // Distance / speed units
  units: UnitSystem;
  onUnitsChange: (value: UnitSystem) => void;
  // Turn-by-turn language + voice
  navLanguage: NavLanguage;
  onNavLanguageChange: (value: NavLanguage) => void;
  voiceEnabled: boolean;
  onToggleVoice: (value: boolean) => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  isDarkMode,
  showWazeAlerts,
  onToggleWazeAlerts,
  showSpeedCameras,
  onToggleSpeedCameras,
  showTraffic,
  onToggleTraffic,
  useSatellite,
  onToggleSatellite,
  showAvatarPulse,
  onToggleAvatarPulse,
  policeAlertDistance,
  onPoliceAlertDistanceChange,
  policeAlertSound,
  onTogglePoliceAlertSound,
  use3DMode,
  onToggle3DMode,
  units,
  onUnitsChange,
  navLanguage,
  onNavLanguageChange,
  voiceEnabled,
  onToggleVoice,
}: SettingsModalProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      // Small delay to trigger animation
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
    } else {
      setIsVisible(false);
      // Wait for animation to complete before unmounting
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!shouldRender) return null;

  return (
    <div 
      className={`
        fixed inset-0 z-50 flex items-center justify-center
        transition-opacity duration-300 ease-out
        ${isVisible ? "opacity-100" : "opacity-0"}
      `}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div 
        className={`
          absolute inset-0 bg-black/50 backdrop-blur-sm
          transition-opacity duration-300 ease-out
          ${isVisible ? "opacity-100" : "opacity-0"}
        `} 
      />
      
      {/* Modal */}
      <div 
        className={`
          relative w-[80%] h-[80%] rounded-2xl overflow-hidden
          ${isDarkMode ? "bg-[#1a1a1a] text-white" : "bg-white text-black"}
          shadow-2xl flex flex-col
          transition-all duration-300 ease-out
          ${isVisible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-4"}
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`
          flex items-center justify-between px-6 py-5 border-b
          ${isDarkMode ? "border-white/10" : "border-black/10"}
        `}>
          <h2 className="text-2xl font-semibold">Settings</h2>
          <button
            onClick={() => {
              onClose();
              // Track settings closed event
              posthog.capture("settings_closed");
            }}
            className={`
              w-12 h-12 rounded-xl flex items-center justify-center
              ${isDarkMode ? "hover:bg-white/10" : "hover:bg-black/5"}
              transition-colors
            `}
            aria-label="Close settings"
          >
            <CloseIcon className="w-7 h-7" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-lg mx-auto space-y-8">
            {/* Map Style Section */}
            <div>
              <h3 className={`text-base font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Map Style
              </h3>
              
              <div className="space-y-4">
                {/* Satellite Toggle */}
                <div className={`
                  flex items-center justify-between p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-4">
                    <span className="text-3xl">🛰️</span>
                    <div>
                      <div className="text-lg font-medium">Satellite View</div>
                      <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Use satellite imagery instead of standard map
                      </div>
                    </div>
                  </div>
                  <Toggle
                    enabled={useSatellite}
                    onToggle={(value) => {
                      onToggleSatellite(value);
                      // Track satellite view toggle
                      posthog.capture("satellite_view_toggled", {
                        satellite_enabled: value,
                      });
                    }}
                    isDarkMode={isDarkMode}
                  />
                </div>
              </div>
            </div>

            {/* Map Layers Section */}
            <div>
              <h3 className={`text-base font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Map Layers
              </h3>
              
              <div className="space-y-4">
                {/* Police reports toggle */}
                <div className={`
                  flex items-center justify-between p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-4">
                    <ShieldExclamationIcon className="w-8 h-8 text-blue-500" />
                    <div>
                      <div className="text-lg font-medium">Police Reports</div>
                      <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Police reported by drivers
                      </div>
                    </div>
                  </div>
                  <Toggle
                    enabled={showWazeAlerts}
                    onToggle={(value) => {
                      onToggleWazeAlerts(value);
                      // Track Waze alerts toggle
                      posthog.capture("waze_alerts_toggled", {
                        alerts_enabled: value,
                      });
                    }}
                    isDarkMode={isDarkMode}
                  />
                </div>

                {/* Speed Cameras Toggle */}
                <div className={`
                  flex items-center justify-between p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-4">
                    <span className="text-3xl">📷</span>
                    <div>
                      <div className="text-lg font-medium">Speed Cameras</div>
                      <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Speed, average-speed and red light cameras (DGT, Catalonia, OpenStreetMap)
                      </div>
                    </div>
                  </div>
                  <Toggle
                    enabled={showSpeedCameras}
                    onToggle={(value) => {
                      onToggleSpeedCameras(value);
                      // Track speed cameras toggle
                      posthog.capture("speed_cameras_toggled", {
                        cameras_enabled: value,
                      });
                    }}
                    isDarkMode={isDarkMode}
                  />
                </div>

                {/* Traffic Toggle */}
                <div className={`
                  flex items-center justify-between p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-4">
                    <MapIcon className="w-8 h-8 text-orange-500" />
                    <div>
                      <div className="text-lg font-medium">Traffic Layer</div>
                      <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Show real-time traffic congestion
                      </div>
                    </div>
                  </div>
                  <Toggle
                    enabled={showTraffic}
                    onToggle={(value) => {
                      onToggleTraffic(value);
                      // Track traffic layer toggle
                      posthog.capture("traffic_layer_toggled", {
                        traffic_enabled: value,
                      });
                    }}
                    isDarkMode={isDarkMode}
                  />
                </div>
              </div>
            </div>

            {/* Units Section */}
            <div>
              <h3 className={`text-base font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Units
              </h3>
              <div className={`
                p-5 rounded-xl flex gap-2
                ${isDarkMode ? "bg-white/5" : "bg-black/5"}
              `}>
                {([
                  { value: "metric", label: "Kilometers · km/h" },
                  { value: "imperial", label: "Miles · mph" },
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onUnitsChange(option.value)}
                    className={`
                      flex-1 px-4 py-3 rounded-xl text-base font-medium transition-all
                      ${units === option.value
                        ? "bg-blue-500 text-white"
                        : isDarkMode
                          ? "bg-white/10 hover:bg-white/20 text-white"
                          : "bg-black/10 hover:bg-black/20 text-black"
                      }
                    `}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Voice Guidance Section */}
            <div>
              <h3 className={`text-base font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Voice &amp; Directions
              </h3>
              <div className={`
                p-5 rounded-xl flex flex-wrap gap-2
                ${isDarkMode ? "bg-white/5" : "bg-black/5"}
              `}>
                {NAV_LANGUAGES.map((option) => (
                  <button
                    key={option.code}
                    onClick={() => onNavLanguageChange(option.code)}
                    className={`
                      flex-1 px-4 py-3 rounded-xl text-base font-medium transition-all
                      ${navLanguage === option.code
                        ? "bg-blue-500 text-white"
                        : isDarkMode
                          ? "bg-white/10 hover:bg-white/20 text-white"
                          : "bg-black/10 hover:bg-black/20 text-black"
                      }
                    `}
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  onClick={() => onToggleVoice(!voiceEnabled)}
                  aria-pressed={voiceEnabled}
                  className={`
                    flex-1 px-4 py-3 rounded-xl text-base font-medium transition-all
                    ${voiceEnabled
                      ? "bg-blue-500 text-white"
                      : isDarkMode
                        ? "bg-white/10 hover:bg-white/20 text-white"
                        : "bg-black/10 hover:bg-black/20 text-black"
                    }
                  `}
                >
                  {voiceEnabled ? "🔊 Voice on" : "🔇 Voice off"}
                </button>
              </div>
            </div>

            {/* Police Alerts Section */}
            <div>
              <h3 className={`text-base font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Police Alerts
              </h3>
              
              <div className="space-y-4">
                {/* Alert Distance Selector */}
                <div className={`
                  p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-4 mb-4">
                    <ShieldExclamationIcon className="w-8 h-8 text-blue-500" />
                    <div>
                      <div className="text-lg font-medium">Alert Distance</div>
                      <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Get notified when police are within this distance
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {policeAlertDistanceOptions(units).map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          onPoliceAlertDistanceChange(option.value);
                          posthog.capture("police_alert_distance_changed", {
                            distance_meters: option.value,
                          });
                        }}
                        className={`
                          px-4 py-2.5 rounded-xl text-base font-medium transition-all
                          ${policeAlertDistance === option.value
                            ? "bg-blue-500 text-white"
                            : isDarkMode 
                              ? "bg-white/10 hover:bg-white/20 text-white" 
                              : "bg-black/10 hover:bg-black/20 text-black"
                          }
                        `}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sound Alert Toggle */}
                <div className={`
                  flex items-center justify-between p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                  ${policeAlertDistance === 0 ? "opacity-50 pointer-events-none" : ""}
                `}>
                  <div className="flex items-center gap-4">
                    <span className="text-3xl">🔊</span>
                    <div>
                      <div className="text-lg font-medium">Sound Alert</div>
                      <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Play audio when police are nearby
                      </div>
                    </div>
                  </div>
                  <Toggle
                    enabled={policeAlertSound}
                    onToggle={(value) => {
                      onTogglePoliceAlertSound(value);
                      posthog.capture("police_alert_sound_toggled", {
                        sound_enabled: value,
                      });
                    }}
                    isDarkMode={isDarkMode}
                  />
                </div>
              </div>
            </div>

            {/* Appearance Section */}
            <div>
              <h3 className={`text-base font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Appearance
              </h3>
              
              <div className="space-y-4">
                {/* Avatar Pulse Toggle */}
                <div className={`
                  flex items-center justify-between p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-4">
                    <span className="text-3xl">💫</span>
                    <div>
                      <div className="text-lg font-medium">Location Pulse</div>
                      <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Animated pulse around your avatar
                      </div>
                    </div>
                  </div>
                  <Toggle
                    enabled={showAvatarPulse}
                    onToggle={(value) => {
                      onToggleAvatarPulse(value);
                      // Track avatar pulse toggle
                      posthog.capture("avatar_pulse_toggled", {
                        pulse_enabled: value,
                      });
                    }}
                    isDarkMode={isDarkMode}
                  />
                </div>

              </div>
            </div>

            {/* Experimental Section */}
            <div>
              <h3 className={`text-base font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Experimental
              </h3>
              
              <div className="space-y-4">
                {/* 3D Mode Toggle */}
                <div className={`
                  p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <span className="text-3xl">🏔️</span>
                      <div>
                        <div className="text-lg font-medium">3D Map View</div>
                        <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                          Show terrain elevation with tilted camera
                        </div>
                      </div>
                    </div>
                    <Toggle
                      enabled={use3DMode}
                      onToggle={(value) => {
                        onToggle3DMode(value);
                        posthog.capture("3d_mode_toggled", {
                          mode_enabled: value,
                        });
                      }}
                      isDarkMode={isDarkMode}
                    />
                  </div>
                  <div className={`
                    mt-4 p-3 rounded-lg text-sm
                    ${isDarkMode ? "bg-amber-500/10 text-amber-200" : "bg-amber-50 text-amber-700"}
                  `}>
                    <span className="font-medium">Note:</span> 3D mode may not work on older Tesla browsers. Enabling this will also activate follow mode for the best experience.
                  </div>
                </div>
              </div>
            </div>

            {/* About Section */}
            <div>
              <h3 className={`text-base font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                About
              </h3>
              <div className={`
                p-5 rounded-xl
                ${isDarkMode ? "bg-white/5" : "bg-black/5"}
              `}>
                <div className="text-lg font-medium">{APP_NAME}</div>
                <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  {APP_DESCRIPTION}
                </div>
                <div className={`text-sm mt-2 ${isDarkMode ? "text-gray-500" : "text-gray-400"}`}>
                  Based on teslanav by Ryan Vogel · PolyForm Noncommercial 1.0.0
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Toggle Switch Component
function Toggle({ 
  enabled, 
  onToggle,
  isDarkMode 
}: { 
  enabled: boolean; 
  onToggle: (value: boolean) => void;
  isDarkMode: boolean;
}) {
  return (
    <button
      onClick={() => onToggle(!enabled)}
      className={`
        relative w-16 h-9 rounded-full transition-colors duration-200 flex-shrink-0
        ${enabled 
          ? "bg-blue-500" 
          : isDarkMode ? "bg-white/20" : "bg-black/20"
        }
      `}
      aria-label={enabled ? "Disable" : "Enable"}
    >
      <div
        className={`
          absolute top-1 w-7 h-7 rounded-full bg-white shadow-md
          transition-transform duration-200
          ${enabled ? "translate-x-8" : "translate-x-1"}
        `}
      />
    </button>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}


function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}
