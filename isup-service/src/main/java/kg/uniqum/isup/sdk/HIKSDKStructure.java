/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0),
 * class com.oldwei.isup.sdk.HIKSDKStructure. See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

import com.sun.jna.Structure;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.List;

/**
 * Базовый класс для всех JNA-структур Hikvision ISUP SDK:
 * порядок полей берётся из порядка объявления public-полей.
 */
public class HIKSDKStructure extends Structure {
    @Override
    protected List<String> getFieldOrder() {
        List<String> fieldOrderList = new ArrayList<>();
        for (Class<?> cls = getClass();
             !cls.equals(HIKSDKStructure.class);
             cls = cls.getSuperclass()) {
            Field[] fields = cls.getDeclaredFields();
            for (Field field : fields) {
                int modifiers = field.getModifiers();
                if (Modifier.isStatic(modifiers) || !Modifier.isPublic(modifiers)) {
                    continue;
                }
                fieldOrderList.add(field.getName());
            }
        }
        return fieldOrderList;
    }
}
