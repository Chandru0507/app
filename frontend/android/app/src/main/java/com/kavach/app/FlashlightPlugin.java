package com.kavach.app;

import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraManager;
import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native Android flashlight plugin.
 * Uses CameraManager.setTorchMode() which does NOT require the CAMERA permission.
 * Requires the device to have a flash unit.
 */
@CapacitorPlugin(name = "Flashlight")
public class FlashlightPlugin extends Plugin {

    private CameraManager cameraManager;
    private String cameraId;
    private boolean isOn = false;

    @Override
    public void load() {
        cameraManager = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
        if (cameraManager != null) {
            try {
                for (String id : cameraManager.getCameraIdList()) {
                    Boolean hasFlash = cameraManager.getCameraCharacteristics(id)
                            .get(android.hardware.camera2.CameraCharacteristics.FLASH_INFO_AVAILABLE);
                    if (hasFlash != null && hasFlash) {
                        cameraId = id;
                        break;
                    }
                }
            } catch (CameraAccessException e) {
                cameraId = null;
            }
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", cameraId != null);
        call.resolve(ret);
    }

    @PluginMethod
    public void enable(PluginCall call) {
        if (cameraId == null) {
            call.reject("Flashlight not available on this device");
            return;
        }
        try {
            cameraManager.setTorchMode(cameraId, true);
            isOn = true;
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (CameraAccessException | IllegalArgumentException e) {
            call.reject("Failed to enable flashlight: " + e.getMessage());
        }
    }

    @PluginMethod
    public void disable(PluginCall call) {
        if (cameraId == null) {
            call.reject("Flashlight not available on this device");
            return;
        }
        try {
            cameraManager.setTorchMode(cameraId, false);
            isOn = false;
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (CameraAccessException | IllegalArgumentException e) {
            call.reject("Failed to disable flashlight: " + e.getMessage());
        }
    }

    @PluginMethod
    public void isEnabled(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", isOn);
        call.resolve(ret);
    }
}