import React from 'react';
import { View, Text, Image, TouchableOpacity, ImageBackground } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { styles } from './styles';
import { svgByAsset } from './svgIcons';
import { cairnText } from '../../i18n/runtime';

// Auto-generated from Routes.spec.json  viewport 375x812
// States: R0, R1, R2, R3, R4, R5, R6, R7, R8, R9

type RoutesState = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9';

export function RoutesScreen(props: { state?: RoutesState; initial?: string } = {}) {
  const nav = useNavigation<any>();
  const state = props.state ?? 'R0';
  const initial = props.initial ?? '?';
  return (
    <View style={{ flex: 1, width: 375, height: 812 }}>
      {state === 'R0' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F7F3EA' }} />
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Home' as never)}>
              <Image source={require('../../../assets/routes/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>{cairnText('routes-generated.routes-screen-generated.trails')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/routes/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>{cairnText('routes-generated.routes-screen-generated.friends')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/routes/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>{cairnText('routes-generated.routes-screen-generated.memory')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/routes/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>{cairnText('routes-generated.routes-screen-generated.settings')}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.R0__seg_container}>
            <View style={styles.R0__seg_container__seg_activities}>
              <Text style={styles.R0__seg_container__seg_activities__lbl}>{cairnText('routes-generated.routes-screen-generated.activities')}</Text>
            </View>
            <Text style={styles.R0__seg_container__seg_routes}>{cairnText('routes-generated.routes-screen-generated.routes')}</Text>
            <Text style={styles.R0__seg_container__seg_cairns}>{cairnText('routes-generated.routes-screen-generated.cairns')}</Text>
          </View>
          <View style={styles.R0__chip_all}>
            <Text style={styles.R0__chip_all__lbl}>{cairnText('routes-generated.routes-screen-generated.all')}</Text>
          </View>
          <View style={styles.R0__chip_hiking}>
            <Text style={styles.R0__chip_hiking__lbl}>{cairnText('routes-generated.routes-screen-generated.hiking')}</Text>
          </View>
          <View style={styles.R0__chip_running}>
            <Text style={styles.R0__chip_running__lbl}>{cairnText('routes-generated.routes-screen-generated.running')}</Text>
          </View>
          <View style={styles.R0__chip_recent}>
            <Text style={styles.R0__chip_recent__lbl}>{cairnText('routes-generated.routes-screen-generated.recent')}</Text>
          </View>
          <View style={styles.R0__row_1}>
            <Image source={require('../../../assets/routes/activity-hike.png')} style={styles.R0__row_1__icon} resizeMode="contain" />
            <Text style={styles.R0__row_1__title}>{cairnText('routes-generated.routes-screen-generated.lutanies-loop')}</Text>
            <Text style={styles.R0__row_1__meta}>{cairnText('routes-generated.routes-screen-generated.7-6-2026-3-7-km-05')}</Text>
          </View>
          <View style={styles.R0__row_2}>
            <Image source={require('../../../assets/routes/activity-hike.png')} style={styles.R0__row_2__icon} resizeMode="contain" />
            <Text style={styles.R0__row_2__title}>{cairnText('routes-generated.routes-screen-generated.airport-trail')}</Text>
            <Text style={styles.R0__row_2__meta}>{cairnText('routes-generated.routes-screen-generated.7-6-2026-3-1-km-17')}</Text>
          </View>
          <View style={styles.R0__row_3}>
            <Image source={require('../../../assets/routes/activity-hike.png')} style={styles.R0__row_3__icon} resizeMode="contain" />
            <Text style={styles.R0__row_3__title}>{cairnText('routes-generated.routes-screen-generated.mountain-day')}</Text>
            <Text style={styles.R0__row_3__meta}>{cairnText('routes-generated.routes-screen-generated.7-7-2026-12-4-km-04')}</Text>
          </View>
          <View style={styles.R0__row_4}>
            <Image source={require('../../../assets/routes/activity-hike.png')} style={styles.R0__row_4__icon} resizeMode="contain" />
            <Text style={styles.R0__row_4__title}>{cairnText('routes-generated.routes-screen-generated.sunset-hike')}</Text>
            <Text style={styles.R0__row_4__meta}>{cairnText('routes-generated.routes-screen-generated.7-7-2026-8-2-km-02')}</Text>
          </View>
          <View style={styles.R0__row_5}>
            <Image source={require('../../../assets/routes/activity-hike.png')} style={styles.R0__row_5__icon} resizeMode="contain" />
            <Text style={styles.R0__row_5__title}>{cairnText('routes-generated.routes-screen-generated.forest-walk')}</Text>
            <Text style={styles.R0__row_5__meta}>{cairnText('routes-generated.routes-screen-generated.7-6-2026-4-5-km-01')}</Text>
          </View>
          <View style={styles.R0__row_6}>
            <Image source={require('../../../assets/routes/activity-hike.png')} style={styles.R0__row_6__icon} resizeMode="contain" />
            <Text style={styles.R0__row_6__title}>{cairnText('routes-generated.routes-screen-generated.riverside')}</Text>
            <Text style={styles.R0__row_6__meta}>{cairnText('routes-generated.routes-screen-generated.7-5-2026-6-3-km-01')}</Text>
          </View>
          <View style={styles.R0__row_7}>
            <Image source={require('../../../assets/routes/activity-run.png')} style={styles.R0__row_7__icon} resizeMode="contain" />
            <Text style={styles.R0__row_7__title}>{cairnText('routes-generated.routes-screen-generated.morning-run')}</Text>
            <Text style={styles.R0__row_7__meta}>{cairnText('routes-generated.routes-screen-generated.7-4-2026-5-4-km-00')}</Text>
          </View>
          <View style={styles.R0__row_8}>
            <Image source={require('../../../assets/routes/activity-run.png')} style={styles.R0__row_8__icon} resizeMode="contain" />
            <Text style={styles.R0__row_8__title}>{cairnText('routes-generated.routes-screen-generated.city-run')}</Text>
            <Text style={styles.R0__row_8__meta}>{cairnText('routes-generated.routes-screen-generated.7-3-2026-10-1-km-01')}</Text>
          </View>
          <Image source={require('../../../assets/routes/mountain-hero.png')} style={styles.R0__footer_mountains} resizeMode="contain" />
        </>
      )}
      {state === 'R1' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F7F3EA' }} />
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Home' as never)}>
              <Image source={require('../../../assets/routes/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>{cairnText('routes-generated.routes-screen-generated.trails')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/routes/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>{cairnText('routes-generated.routes-screen-generated.friends')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/routes/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>{cairnText('routes-generated.routes-screen-generated.memory')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/routes/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>{cairnText('routes-generated.routes-screen-generated.settings')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.R1__back}>{'‹'}</Text>
          <View style={styles.R1__map_preview}>
            <Text style={styles.R1__map_preview__map_note}>{cairnText('routes-generated.routes-screen-generated.map-preview')}</Text>
          </View>
          <View style={styles.R1__sheet}>
            <Text style={styles.R1__sheet__title}>{cairnText('routes-generated.routes-screen-generated.lutang-loop')}</Text>
            <Text style={styles.R1__sheet__edit}>{'✎'}</Text>
            <Text style={styles.R1__sheet__stat1_v}>{'3.7'}</Text>
            <Text style={styles.R1__sheet__stat1_l}>{cairnText('routes-generated.routes-screen-generated.km')}</Text>
            <Text style={styles.R1__sheet__stat2_v}>{'05:39'}</Text>
            <Text style={styles.R1__sheet__stat2_l}>{cairnText('routes-generated.routes-screen-generated.time')}</Text>
            <Text style={styles.R1__sheet__stat3_v}>{'+156'}</Text>
            <Text style={styles.R1__sheet__stat3_l}>{cairnText('routes-generated.routes-screen-generated.m')}</Text>
            <Text style={styles.R1__sheet__meta_row}>{cairnText('routes-generated.routes-screen-generated.hiking-7-8-2026-08-21')}</Text>
            <View style={styles.R1__sheet__btn_delete}>
              <Text style={styles.R1__sheet__btn_delete__lbl}>{cairnText('routes-generated.routes-screen-generated.delete')}</Text>
            </View>
            <View style={styles.R1__sheet__btn_save}>
              <Text style={styles.R1__sheet__btn_save__lbl}>{cairnText('routes-generated.routes-screen-generated.save-as-route')}</Text>
            </View>
          </View>
        </>
      )}
      {state === 'R2' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F7F3EA' }} />
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Home' as never)}>
              <Image source={require('../../../assets/routes/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>{cairnText('routes-generated.routes-screen-generated.trails')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/routes/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>{cairnText('routes-generated.routes-screen-generated.friends')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/routes/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>{cairnText('routes-generated.routes-screen-generated.memory')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/routes/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>{cairnText('routes-generated.routes-screen-generated.settings')}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.R2__seg_container}>
            <Text style={styles.R2__seg_container__seg_activities}>{cairnText('routes-generated.routes-screen-generated.activities')}</Text>
            <View style={styles.R2__seg_container__seg_routes}>
              <Text style={styles.R2__seg_container__seg_routes__lbl}>{cairnText('routes-generated.routes-screen-generated.routes')}</Text>
            </View>
            <Text style={styles.R2__seg_container__seg_cairns}>{cairnText('routes-generated.routes-screen-generated.cairns')}</Text>
          </View>
          <Text style={styles.R2__subtab_mine}>{cairnText('routes-generated.routes-screen-generated.mine')}</Text>
          <View style={styles.R2__subtab_mine_underline}>
          </View>
          <Text style={styles.R2__subtab_friends}>{cairnText('routes-generated.routes-screen-generated.friends')}</Text>
          <View style={styles.R2__route_row_1}>
            <View style={styles.R2__route_row_1__thumb}>
            </View>
            <Text style={styles.R2__route_row_1__title}>{cairnText('routes-generated.routes-screen-generated.lutang-loop')}</Text>
            <Text style={styles.R2__route_row_1__meta}>{cairnText('routes-generated.routes-screen-generated.3-7-km-156-m')}</Text>
            <Text style={styles.R2__route_row_1__chev}>{'›'}</Text>
          </View>
          <View style={styles.R2__route_row_2}>
            <View style={styles.R2__route_row_2__thumb}>
            </View>
            <Text style={styles.R2__route_row_2__title}>{cairnText('routes-generated.routes-screen-generated.airport-trail')}</Text>
            <Text style={styles.R2__route_row_2__meta}>{cairnText('routes-generated.routes-screen-generated.3-1-km-98-m')}</Text>
            <Text style={styles.R2__route_row_2__chev}>{'›'}</Text>
          </View>
          <View style={styles.R2__route_row_3}>
            <View style={styles.R2__route_row_3__thumb}>
            </View>
            <Text style={styles.R2__route_row_3__title}>{cairnText('routes-generated.routes-screen-generated.mountain-day')}</Text>
            <Text style={styles.R2__route_row_3__meta}>{cairnText('routes-generated.routes-screen-generated.12-4-km-642-m')}</Text>
            <Text style={styles.R2__route_row_3__chev}>{'›'}</Text>
          </View>
          <View style={styles.R2__route_row_4}>
            <View style={styles.R2__route_row_4__thumb}>
            </View>
            <Text style={styles.R2__route_row_4__title}>{cairnText('routes-generated.routes-screen-generated.sunset-hike')}</Text>
            <Text style={styles.R2__route_row_4__meta}>{cairnText('routes-generated.routes-screen-generated.8-2-km-276-m')}</Text>
            <Text style={styles.R2__route_row_4__chev}>{'›'}</Text>
          </View>
          <View style={styles.R2__route_row_5}>
            <View style={styles.R2__route_row_5__thumb}>
            </View>
            <Text style={styles.R2__route_row_5__title}>{cairnText('routes-generated.routes-screen-generated.riverside-walk')}</Text>
            <Text style={styles.R2__route_row_5__meta}>{cairnText('routes-generated.routes-screen-generated.6-3-km-112-m')}</Text>
            <Text style={styles.R2__route_row_5__chev}>{'›'}</Text>
          </View>
          <View style={styles.R2__route_row_6}>
            <View style={styles.R2__route_row_6__thumb}>
            </View>
            <Text style={styles.R2__route_row_6__title}>{cairnText('routes-generated.routes-screen-generated.forest-explorer')}</Text>
            <Text style={styles.R2__route_row_6__meta}>{cairnText('routes-generated.routes-screen-generated.9-6-km-340-m')}</Text>
            <Text style={styles.R2__route_row_6__chev}>{'›'}</Text>
          </View>
          <Image source={require('../../../assets/routes/mountain-hero.png')} style={styles.R2__footer_mountains} resizeMode="contain" />
        </>
      )}
      {state === 'R3' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F7F3EA' }} />
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Home' as never)}>
              <Image source={require('../../../assets/routes/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>{cairnText('routes-generated.routes-screen-generated.trails')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/routes/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>{cairnText('routes-generated.routes-screen-generated.friends')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/routes/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>{cairnText('routes-generated.routes-screen-generated.memory')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/routes/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>{cairnText('routes-generated.routes-screen-generated.settings')}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.R3__seg_container}>
            <Text style={styles.R3__seg_container__seg_activities}>{cairnText('routes-generated.routes-screen-generated.activities')}</Text>
            <View style={styles.R3__seg_container__seg_routes}>
              <Text style={styles.R3__seg_container__seg_routes__lbl}>{cairnText('routes-generated.routes-screen-generated.routes')}</Text>
            </View>
            <Text style={styles.R3__seg_container__seg_cairns}>{cairnText('routes-generated.routes-screen-generated.cairns')}</Text>
          </View>
          <Text style={styles.R3__subtab_mine}>{cairnText('routes-generated.routes-screen-generated.mine')}</Text>
          <Text style={styles.R3__subtab_friends}>{cairnText('routes-generated.routes-screen-generated.friends')}</Text>
          <View style={styles.R3__subtab_friends_underline}>
          </View>
          <Image source={require('../../../assets/routes/mountain-hero.png')} style={styles.R3__hero_illust} resizeMode="contain" />
          <Text style={styles.R3__empty_title}>{cairnText('routes-generated.routes-screen-generated.no-routes-from-friends-yet')}</Text>
          <Text style={styles.R3__empty_sub}>{cairnText('routes-generated.routes-screen-generated.when-your-friends-share-routes-they-ll')}</Text>
          <Image source={require('../../../assets/routes/mountain-hero.png')} style={styles.R3__footer_mountains} resizeMode="contain" />
        </>
      )}
      {state === 'R4' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F7F3EA' }} />
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Home' as never)}>
              <Image source={require('../../../assets/routes/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>{cairnText('routes-generated.routes-screen-generated.trails')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/routes/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>{cairnText('routes-generated.routes-screen-generated.friends')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/routes/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>{cairnText('routes-generated.routes-screen-generated.memory')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/routes/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>{cairnText('routes-generated.routes-screen-generated.settings')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.R4__back}>{'‹'}</Text>
          <View style={styles.R4__map_preview}>
            <Text style={styles.R4__map_preview__map_note}>{cairnText('routes-generated.routes-screen-generated.map-preview')}</Text>
          </View>
          <View style={styles.R4__sheet}>
            <Text style={styles.R4__sheet__title}>{cairnText('routes-generated.routes-screen-generated.lutang-loop')}</Text>
            <Text style={styles.R4__sheet__edit}>{'✎'}</Text>
            <Text style={styles.R4__sheet__stat1_v}>{'3.7'}</Text>
            <Text style={styles.R4__sheet__stat1_l}>{cairnText('routes-generated.routes-screen-generated.km')}</Text>
            <Text style={styles.R4__sheet__stat2_v}>{'05:39'}</Text>
            <Text style={styles.R4__sheet__stat2_l}>{cairnText('routes-generated.routes-screen-generated.time')}</Text>
            <Text style={styles.R4__sheet__stat3_v}>{'+156'}</Text>
            <Text style={styles.R4__sheet__stat3_l}>{cairnText('routes-generated.routes-screen-generated.m')}</Text>
            <View style={styles.R4__sheet__btn_edit}>
              <Text style={styles.R4__sheet__btn_edit__lbl}>{cairnText('routes-generated.routes-screen-generated.edit-route')}</Text>
            </View>
            <View style={styles.R4__sheet__btn_delete}>
              <Text style={styles.R4__sheet__btn_delete__lbl}>{cairnText('routes-generated.routes-screen-generated.delete-96bb14f')}</Text>
            </View>
          </View>
        </>
      )}
      {state === 'R5' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F7F3EA' }} />
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Home' as never)}>
              <Image source={require('../../../assets/routes/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>{cairnText('routes-generated.routes-screen-generated.trails')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/routes/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>{cairnText('routes-generated.routes-screen-generated.friends')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/routes/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>{cairnText('routes-generated.routes-screen-generated.memory')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/routes/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>{cairnText('routes-generated.routes-screen-generated.settings')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.R5__back}>{'‹'}</Text>
          <Text style={styles.R5__title}>{cairnText('routes-generated.routes-screen-generated.edit-route-53f9701')}</Text>
          <View style={styles.R5__map_preview}>
            <Text style={styles.R5__map_preview__map_note}>{cairnText('routes-generated.routes-screen-generated.map-preview')}</Text>
          </View>
          <View style={styles.R5__toolbar}>
            <View style={styles.R5__toolbar__tool_beautify}>
              <View style={styles.R5__toolbar__tool_beautify__icon_bg}>
                <Text style={styles.R5__toolbar__tool_beautify__icon_bg__ico}>{'✧'}</Text>
              </View>
              <Text style={styles.R5__toolbar__tool_beautify__lbl}>{cairnText('routes-generated.routes-screen-generated.beautify')}</Text>
            </View>
            <View style={styles.R5__toolbar__tool_trim}>
              <View style={styles.R5__toolbar__tool_trim__icon_bg}>
                <Text style={styles.R5__toolbar__tool_trim__icon_bg__ico}>{'✂'}</Text>
              </View>
              <Text style={styles.R5__toolbar__tool_trim__lbl}>{cairnText('routes-generated.routes-screen-generated.trim')}</Text>
            </View>
            <View style={styles.R5__toolbar__tool_draw}>
              <View style={styles.R5__toolbar__tool_draw__icon_bg}>
                <Text style={styles.R5__toolbar__tool_draw__icon_bg__ico}>{'✎'}</Text>
              </View>
              <Text style={styles.R5__toolbar__tool_draw__lbl}>{cairnText('routes-generated.routes-screen-generated.draw')}</Text>
            </View>
            <View style={styles.R5__toolbar__tool_move}>
              <View style={styles.R5__toolbar__tool_move__icon_bg}>
                <Text style={styles.R5__toolbar__tool_move__icon_bg__ico}>{'✥'}</Text>
              </View>
              <Text style={styles.R5__toolbar__tool_move__lbl}>{cairnText('routes-generated.routes-screen-generated.move')}</Text>
            </View>
          </View>
          <View style={styles.R5__btn_preview}>
            <Text style={styles.R5__btn_preview__lbl}>{cairnText('routes-generated.routes-screen-generated.preview')}</Text>
          </View>
        </>
      )}
      {state === 'R6' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F7F3EA' }} />
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Home' as never)}>
              <Image source={require('../../../assets/routes/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>{cairnText('routes-generated.routes-screen-generated.trails')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/routes/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>{cairnText('routes-generated.routes-screen-generated.friends')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/routes/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>{cairnText('routes-generated.routes-screen-generated.memory')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/routes/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>{cairnText('routes-generated.routes-screen-generated.settings')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.R6__back}>{'‹'}</Text>
          <Text style={styles.R6__title}>{cairnText('routes-generated.routes-screen-generated.trim')}</Text>
          <View style={styles.R6__map_preview}>
            <Text style={styles.R6__map_preview__map_note}>{cairnText('routes-generated.routes-screen-generated.map-with-orange-trim-handles')}</Text>
          </View>
          <View style={styles.R6__hint_card}>
            <Text style={styles.R6__hint_card__line1}>{cairnText('routes-generated.routes-screen-generated.start-on-the-route-and-draw')}</Text>
            <Text style={styles.R6__hint_card__line2}>{cairnText('routes-generated.routes-screen-generated.to-add-or-adjust-keeping-it-natural')}</Text>
          </View>
          <View style={styles.R6__btn_path}>
            <Text style={styles.R6__btn_path__lbl}>{cairnText('routes-generated.routes-screen-generated.path')}</Text>
          </View>
          <View style={styles.R6__btn_erase}>
            <Text style={styles.R6__btn_erase__lbl}>{cairnText('routes-generated.routes-screen-generated.erase')}</Text>
          </View>
        </>
      )}
      {state === 'R7' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F7F3EA' }} />
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Home' as never)}>
              <Image source={require('../../../assets/routes/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>{cairnText('routes-generated.routes-screen-generated.trails')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/routes/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>{cairnText('routes-generated.routes-screen-generated.friends')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/routes/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>{cairnText('routes-generated.routes-screen-generated.memory')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/routes/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>{cairnText('routes-generated.routes-screen-generated.settings')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.R7__back}>{'‹'}</Text>
          <Text style={styles.R7__title}>{cairnText('routes-generated.routes-screen-generated.draw')}</Text>
          <View style={styles.R7__map_preview}>
            <Text style={styles.R7__map_preview__map_note}>{cairnText('routes-generated.routes-screen-generated.map-with-dashed-drawing-segment')}</Text>
          </View>
          <View style={styles.R7__hint_card}>
            <Text style={styles.R7__hint_card__line1}>{cairnText('routes-generated.routes-screen-generated.start-on-the-route-and-draw')}</Text>
            <Text style={styles.R7__hint_card__line2}>{cairnText('routes-generated.routes-screen-generated.to-add-or-adjust-keeping-it-natural')}</Text>
          </View>
          <View style={styles.R7__btn_path}>
            <Text style={styles.R7__btn_path__lbl}>{cairnText('routes-generated.routes-screen-generated.path')}</Text>
          </View>
          <View style={styles.R7__btn_erase}>
            <Text style={styles.R7__btn_erase__lbl}>{cairnText('routes-generated.routes-screen-generated.erase')}</Text>
          </View>
        </>
      )}
      {state === 'R8' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F7F3EA' }} />
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Home' as never)}>
              <Image source={require('../../../assets/routes/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>{cairnText('routes-generated.routes-screen-generated.trails')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/routes/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>{cairnText('routes-generated.routes-screen-generated.friends')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/routes/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>{cairnText('routes-generated.routes-screen-generated.memory')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/routes/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>{cairnText('routes-generated.routes-screen-generated.settings')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.R8__back}>{'‹'}</Text>
          <Text style={styles.R8__title}>{cairnText('routes-generated.routes-screen-generated.beautify')}</Text>
          <View style={styles.R8__map_preview}>
            <Text style={styles.R8__map_preview__map_note}>{cairnText('routes-generated.routes-screen-generated.smoothed-route-with-sparkle')}</Text>
          </View>
          <View style={styles.R8__hint_card}>
            <Text style={styles.R8__hint_card__line1}>{cairnText('routes-generated.routes-screen-generated.beautify-smooths-jagged-edges')}</Text>
            <Text style={styles.R8__hint_card__line2}>{cairnText('routes-generated.routes-screen-generated.so-your-route-feels-natural')}</Text>
          </View>
          <View style={styles.R8__btn_apply}>
            <Text style={styles.R8__btn_apply__lbl}>{cairnText('routes-generated.routes-screen-generated.apply')}</Text>
          </View>
        </>
      )}
      {state === 'R9' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F7F3EA' }} />
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Home' as never)}>
              <Image source={require('../../../assets/routes/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>{cairnText('routes-generated.routes-screen-generated.trails')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/routes/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>{cairnText('routes-generated.routes-screen-generated.friends')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/routes/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>{cairnText('routes-generated.routes-screen-generated.memory')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/routes/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>{cairnText('routes-generated.routes-screen-generated.settings')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.R9__back}>{'‹'}</Text>
          <Text style={styles.R9__title}>{cairnText('routes-generated.routes-screen-generated.move')}</Text>
          <View style={styles.R9__map_preview}>
            <Text style={styles.R9__map_preview__map_note}>{cairnText('routes-generated.routes-screen-generated.route-with-drag-arrows')}</Text>
          </View>
          <View style={styles.R9__hint_card}>
            <Text style={styles.R9__hint_card__line1}>{cairnText('routes-generated.routes-screen-generated.drag-the-route-to-move')}</Text>
            <Text style={styles.R9__hint_card__line2}>{cairnText('routes-generated.routes-screen-generated.its-position')}</Text>
          </View>
          <View style={styles.R9__btn_reset}>
            <Text style={styles.R9__btn_reset__lbl}>{cairnText('routes-generated.routes-screen-generated.reset')}</Text>
          </View>
          <View style={styles.R9__btn_done}>
            <Text style={styles.R9__btn_done__lbl}>{cairnText('common.done')}</Text>
          </View>
        </>
      )}
    </View>
  );
}