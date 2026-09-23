import{navigationIndex}from"../../store/navigation";import{initializeCapsuleBackdrop,attachCapsuleBackdrop,detachCapsuleBackdrop,invalidateCapsuleBackdrop,type CapsuleScrollHost,
}from"../../utils/capsule-backdrop";import{buildAppShare,buildTimelineShare,enableTimelineShare,
}from"../../utils/app-share";import{loadInteractionDraft,saveInteractionDraft,clearInteractionDraft,
}from"../../store/interaction-drafts";import{currentIsoWeekday as wd,coursesForDate,timetableWeekCount,timetableWeekForDisplay,weekDateKeys,
}from"../../data/timetable";import{withCustomCourses as addCourses}from"../../data/custom-courses";import{defaultPlanEnd,nextWholeHour}from"../../data/schedule";import{buildScheduleDateView as makeDay,buildSchedulePager as makePager,getPrewarmedScheduleFirstScreen as getWarmScreen,scheduleDateFromKey as asDate,scheduleDayIndex as dayIx,shiftScheduleDate,planOccursOnDate,SCHEDULE_TIMELINE_HEIGHT,type ScheduleDayOption as Day,type ScheduleEntry,
}from"../../data/schedule-render";import{getPreloadedSchedule,getPreloadedTimetable,
}from"../../services/primary-tab-preload";import{getTimetable,putLocalSchedule}from"../../services/teaching";import{claimAutomaticRefresh,FIFTEEN_DAYS_MS,isCacheStale,shouldStoreServerSnapshot,
}from"../../store/cache-policy";import{getScheduleRevision,loadScheduleData as sch,saveScheduleData,
}from"../../store/schedule";import{getPreferencesRevision,loadPreferences,
}from"../../store/preferences";import{captureSessionLease as takeLease,getSession,isSessionLeaseCurrent as lc,type SessionLease as Lease,
}from"../../store/session";import{getTimetableRevision,loadTimetableSnapshot,saveTimetableSnapshot,
}from"../../store/timetable";import type{LocalScheduleCourse,LocalSchedulePlan as Plan,TimetableData as Table,
}from"../../types/api";import{resolveAppearance}from"../../utils/appearance";import{toDateString as dateKey}from"../../utils/date";import{haptic}from"../../utils/haptics";import{ensureAuthenticated,navigateTo}from"../../utils/navigation";type Touch=WechatMiniprogram.TouchEvent;type Event<T extends WechatMiniprogram.IAnyObject>=WechatMiniprogram.CustomEvent<T>;let tb:Table|null=null;const DAY_LABELS=["一","二","三","四","五","六","日"];const ROW_H=92;const WEEKDAY_H=32;type CalendarDay=Day&{hasCourse:boolean;outside:boolean};function calendarMarks(date:string,timetable:Table|null,plans:Plan[]){return{hasPlan:plans.some((plan)=>planOccursOnDate(plan,date)),hasCourse:coursesForDate(timetable,date,asDate(date)).length>0,
};
}
function makeGrid(date:string,selectedDate:string,timetable:Table|null,plans:Plan[]){const selected=asDate(date);const first=new Date(selected.getFullYear(),selected.getMonth(),1,12);const fw=wd(first)-1;const count=6;const fd=shiftScheduleDate(dateKey(first),-fw);const today=dateKey(new Date());const rows=Array.from({length:count},(_,row)=>({row,days:Array.from({length:7},(_,column):CalendarDay=>{const key=shiftScheduleDate(fd,row*7+column);const day=asDate(key);const outside=day.getMonth()!==selected.getMonth();return{weekday:(column+1)as Day["weekday"],shortLabel:DAY_LABELS[column],dateLabel:String(day.getDate()),date:key,isToday:key===today&&!outside,outside,...calendarMarks(key,timetable,plans),
};
}),
}));return{monthRows:rows,monthAnchor:dateKey(first),monthSelected:date.slice(0,7)===selectedDate.slice(0,7),monthHeight:WEEKDAY_H+count*ROW_H,
monthTitle:`${selected.getMonth()+1}月`,
yearTitle:String(selected.getFullYear()),
};
}
function makeMonth(date:string,selectedDate:string,timetable:Table|null,plans:Plan[],page=0){const center=makeGrid(date,selectedDate,timetable,plans),month=asDate(date),picked=asDate(selectedDate);const monthPanels=[-1,0,1].map((offset)=>({...(offset?makeGrid(dateKey(new Date(month.getFullYear(),month.getMonth()+offset,1,12)),selectedDate,timetable,plans):center),id:offset+1,slot:page+offset}));return{...center,monthPanels,pg:page,selectionVisible:date.slice(0,7)===selectedDate.slice(0,7),monthOffset:page+(picked.getFullYear()-month.getFullYear())*12+picked.getMonth()-month.getMonth()};}
function markWeekPages(pages: ReturnType<typeof makePager>["weekPages"], timetable: Table | null, plans: Plan[]) {return pages.map((week) => ({...week,days: week.days.map((day) => ({ ...day, hasCourse: calendarMarks(day.date, timetable, plans).hasCourse })),
}));
}
let acct = "";let tl: Lease | null = null;let sl: Lease | null = null;let warmRev = 0;let tbStamp = 0;let schedRev: string | null = null;let hyd: SSR | null = null;let rt: ReturnType<typeof setTimeout> | undefined;let shown = false;let mv = false;let dy = false;let pd = "";let savedPlan: { date: string; id: string } | null = null;let sy = new Map<string, number>();let swipeEnd = 0;let foldEnd = 0;type SV = WechatMiniprogram.Skyline.SharedValue<number>;interface ScheduleMotion {position: SV;start: SV;width: SV;weekWidth: SV;grid:SV;shade:SV;from:SV;to:SV;drag:SV;ready: SV;active: SV;sequence: SV;
}
type NativeScrollEvent=Event<{ dx:number }>;const INIT_PREFS=loadPreferences();const INIT_STYLE=resolveAppearance(
INIT_PREFS,);const REFRESH_DELAY=520;const runOnJS=wx.worklet?.runOnJS;interface SSR {account:string;date:string;preferences:number;timetable:number;schedule:number;
}
type SSN=Exclude<
keyof SSR,"account" | "date"
>;const SOURCE_NAMES:readonly SSN[]=[
"preferences","timetable","schedule",];function sourceRevs(account: string): SSR {return {account,date: dateKey(new Date()),preferences: getPreferencesRevision(),timetable: getTimetableRevision(),schedule: getScheduleRevision(),
};
}
function sourcesCurrent(account:string):boolean {if (!hyd || hyd.account !== account) {return false;
}
const current=sourceRevs(account);return (
current.date === hyd.date &&
SOURCE_NAMES.every(
(source) => current[source] === hyd?.[source],)
);
}
function markSources(
account:string,sources:readonly SSN[],):void {if (!hyd || hyd.account !== account) {return;
}
const current=sourceRevs(account);const next={ ...hyd,date:current.date };for (const source of sources) next[source]=current[source];hyd=next;
}
function clearRefresh():void {if (rt === undefined) return;clearTimeout(rt);rt=undefined;
}
Page({onShareAppMessage:buildAppShare,onShareTimeline:buildTimelineShare,_capsuleDayScroll:undefined as
WechatMiniprogram.Skyline.SharedValue<number[]> | undefined,_motion: null as ScheduleMotion | null,_viewReady: false,_headerRendered: false,_headerBindingsStarted: false,_settling:false,_touchMonth: null as { x: number; y: number; b:number } | null,_foldTouchStart: null as { y: number; progress: number; moved: boolean } | null,_nativeCurrent: 7 + wd() - 1,data: {homeRemoved: false,...INIT_STYLE,currentTime: "",monthLabel: "",teachingWeekLabel: "",days: [] as Day[],selectedWeekday: wd(),selectedDate: dateKey(new Date()),selectedDateLabel: "",entries: [] as ScheduleEntry[],dayPages: [] as ReturnType<typeof makePager>["dayPages"],weekPages: [] as ReturnType<typeof makePager>["weekPages"],dayCurrent: 7 + wd() - 1,dayAnimated: false,daySlide:"",headerMotionReady: false,monthOpen: false,selectionVisible:true,foldProgress: 0,foldDragging: false,mx:0,swiping:false,pg:0,monthAnchor: dateKey(new Date()),monthOffset:0,monthPanels:[] as ReturnType<typeof makeMonth>["monthPanels"],weekdays: DAY_LABELS,monthHeight: 128,monthTitle: "",yearTitle: "",dayScrollTops: [] as number[],focusedPlanId: "",timelineHeight: SCHEDULE_TIMELINE_HEIGHT,creating: false,creatorMode: "plan" as "plan" | "course",creatorSheetHeight: 58,courseTimeOpen: false,courseWeeksOpen: false,courseTimeExpandHeight: 0,courseLocation: "",courseTeacher: "",savingCourse: false,editingCourseId: "",editingCourseDate: "",courseWeekdays: [wd()] as number[],courseWeekdayOptions: DAY_LABELS.map((label, index) => ({ weekday: index + 1, label, selected: index + 1 === wd() })),coursePeriods: [] as number[],courseWeeks: [] as number[],coursePeriodOptions: [] as Array<{period: number;time: string;selected: boolean;
}>,courseWeekOptions:[] as Array<{week:number;dateLabel:string;selected:boolean;
}>,title: "",startDate: dateKey(new Date()),startTime: "20:00",endDate: dateKey(new Date()),endTime: "21:00",endDirty: false,editingPlanId: "",
},onLoad() {enableTimelineShare();initializeCapsuleBackdrop(this);mv = false;dy = false;pd = "";savedPlan = null;sy = new Map();const position = dayIx(this.data.selectedDate);if (wx.worklet?.shared)
this._motion={position:wx.worklet.shared(position),start:wx.worklet.shared(position),width:wx.worklet.shared(wx.getWindowInfo().windowWidth),weekWidth:wx.worklet.shared(
(wx.getWindowInfo().windowWidth * 670) / 750,),grid:wx.worklet.shared(position),shade:wx.worklet.shared(1),from:wx.worklet.shared(position),to:wx.worklet.shared(position),drag:wx.worklet.shared(0),ready:wx.worklet.shared(0),active:wx.worklet.shared(0),sequence:wx.worklet.shared(0),
};shown = false;hyd = null;const account = getSession()?.user.account || "";if (account) this.hydrate(account, true);
},onReady() {attachCapsuleBackdrop(this, "schedule");this._viewReady = true;this.bindWeekMotion();this.measureDayPager();
},syncOrb() {const m=this._motion;if(!m)return;const d=asDate(this.data.selectedDate),first=new Date(d.getFullYear(),d.getMonth(),1,12);m.grid.value=dayIx(dateKey(first))-wd(first)+1;m.shade.value=this.data.selectedDate.slice(0,7)===this.data.monthAnchor.slice(0,7)?1:0;
},bindWeekMotion() {const motion=this._motion;if (
!motion ||
!this._viewReady ||
!this._headerRendered ||
this._headerBindingsStarted
)
return;this._headerBindingsStarted=true;this.syncOrb();const dp=motion.position;const weekWidth=motion.weekWidth;const host=this as unknown as WechatMiniprogram.Component.TrivialInstance;let remaining=3*(2+7*2)+2+6*7*2;const bound=() => {remaining -= 1;if (remaining === 0 && this._motion === motion)
this.setData({ headerMotionReady:true });
};const config = { immediate: true, flush: "sync" as const };for (let slot = 0; slot < 3; slot += 1) {host.applyAnimatedStyle(
".week-strip-slot-" + slot,() => {"worklet";const position = dp.value;const week = Math.floor(position / 7);const offset = (slot - (week % 3) + 3) % 3;const shift =
(offset === 2 ? -1 : offset) - Math.max(0, position - week * 7 - 6);return {transform: "translateX(" + shift * weekWidth.value + "px)",
};
},config,bound,);host.applyAnimatedStyle(
".week-selection-slot-" + slot,() => {"worklet";const week = Math.floor(dp.value / 7);const offset = (slot - (week % 3) + 3) % 3;const slotWeek = week + (offset === 2 ? -1 : offset);const position = Math.max(
0,Math.min(6, dp.value - slotWeek * 7),);return {transform: "translateX(" + (position * weekWidth.value) / 7 + "px)",
};
},config,bound,);for (let weekday=1; weekday <= 7; weekday += 1) for(const selected of [false,true]) host.applyAnimatedStyle(
 ".week-date-"+slot+"-"+weekday+(selected?"-selected":"-normal"),() => {"worklet";const position=dp.value,week=Math.floor(position/7),offset=(slot-(week%3)+3)%3,slotWeek=week+(offset===2?-1:offset),day=slotWeek*7+weekday-1,weight=Math.max(0,1-Math.abs(position-day));return{opacity:""+(selected?weight:1-weight*weight*weight*weight)};
},config,bound,);
}
const grid=motion.grid,from=motion.from,to=motion.to;host.applyAnimatedStyle(".orb-live",() => {"worklet";const p=dp.value-grid.value,linear=to.value!==from.value,a=linear?from.value-grid.value:Math.floor(p),b=linear?to.value-grid.value:a+1,t=linear?(dp.value-from.value)/(to.value-from.value):p-a,ar=Math.floor(a/7),br=Math.floor(b/7),c=a-ar*7+(b-br*7-a+ar*7)*t,r=ar+(br-ar)*t,scale=weekWidth.value/670,x=(c+.5)*weekWidth.value/7-33*scale,y=(36+r*92)*scale;return{transform:"translate("+x+"px,"+y+"px)"};
},config,bound,);
host.applyAnimatedStyle(".month-drag-layer",()=>{"worklet";return{transform:"translateX("+motion.drag.value+"px)"}},config,bound);
for(let row=0;row<6;row++)for(let column=1;column<=7;column++)for(const selected of [false,true])host.applyAnimatedStyle(".md-"+row+"-"+column+(selected?"-selected":"-normal"),()=>{"worklet";const day=grid.value+row*7+column-1,start=from.value,end=to.value,p=dp.value,progress=end===start?Math.max(0,1-Math.abs(p-day)):day===start?Math.max(0,Math.min(1,(end-p)/(end-start))):day===end?Math.max(0,Math.min(1,(p-start)/(end-start))):0,weight=progress*motion.shade.value;return{opacity:""+(selected?weight:1-weight*weight*weight*weight)}},config,bound);
},onResize() {invalidateCapsuleBackdrop(this);this.measureDayPager();
},measureDayPager() {const query = this.createSelectorQuery();query.select(".day-swiper").boundingClientRect();query.select(".week-viewport").boundingClientRect();query.exec(
(rects:WechatMiniprogram.BoundingClientRectCallbackResult[]) => {const [pager,week]=rects;if (!this._motion || !pager?.width || !week?.width) return;this._motion.width.value=pager.width;this._motion.weekWidth.value=week.width;
},);
},onShow() {this.setData({ homeRemoved: navigationIndex("home") < 0 });if (!ensureAuthenticated()) return;shown = true;attachCapsuleBackdrop(this, "schedule");const account = getSession()?.user.account || "";if (!account) return;this.hydrate(account);const tabBar = this.getTabBar();if (tabBar) {tabBar.setData({selected: navigationIndex("schedule"),themeClass: this.data.themeClass,visualThemeClass: this.data.visualThemeClass,motionClass: this.data.motionClass,hidden: false,
});
}
this.scheduleBackgroundRefresh(REFRESH_DELAY);
},onHide() {detachCapsuleBackdrop(this);shown = false;clearRefresh();swipeEnd = 0;foldEnd = 0;mv = false;pd = "";if (this._motion) {const day = this.data.dayPages[this._nativeCurrent];if (day) this.setData({ selectedDate: day.selectedDate });this._motion.active.value = 0;
}
if (savedPlan) {this.setData({selectedDate:savedPlan.date,focusedPlanId:savedPlan.id,
});savedPlan=null;
}
this.rebuildWeek(true);if (this.data.creating || this.data.editingPlanId) {this.setData({ creating:false });
}
this.setTabBarHidden(false);
},onUnload() {detachCapsuleBackdrop(this);shown=false;clearRefresh();swipeEnd=0;foldEnd=0;this._motion=null;
},setTabBarHidden(hidden:boolean) {const tabBar=this.getTabBar();if (tabBar) tabBar.setData({ hidden });
},hydrate(account:string,force=false):boolean {if (!force && sourcesCurrent(account)) return false;const previous=hyd;const current=sourceRevs(account);const accountChanged=!previous || previous.account !== account;const preferencesChanged =
force || accountChanged || previous.preferences !== current.preferences;const contentChanged =
force ||
accountChanged ||
previous.date !== current.date ||
previous.timetable !== current.timetable ||
previous.schedule !== current.schedule;const patch:Record<string,unknown>={};if (preferencesChanged) {Object.assign(patch,resolveAppearance(loadPreferences()));
}
if (contentChanged) {const timetable=loadTimetableSnapshot(account);const schedule=sch(account);const candidate=force ? getWarmScreen(account) :null;const warm =
candidate &&
candidate.timetableStoredAt === (timetable?.localStoredAt || 0) &&
candidate.scheduleUpdatedAt === schedule.clientUpdatedAt
? candidate
:null;acct=account;if (warm) {tb=addCourses(
warm.timetable,schedule.courses,);warmRev=warm.revision;tbStamp=warm.timetableStoredAt;schedRev=warm.scheduleUpdatedAt;Object.assign(patch,warm.view);
} else {tb=addCourses(
timetable?.data || null,schedule.courses,);warmRev=0;tbStamp=timetable?.localStoredAt || 0;schedRev=schedule.clientUpdatedAt;Object.assign(
patch,makeDay(
tb,schedule.plans,accountChanged ? dateKey(new Date()) :this.data.selectedDate,),);
}
if (accountChanged) {sy.clear();mv = false;pd = "";savedPlan = null;Object.assign(patch, {creating: false,editingPlanId: "",title: "",focusedPlanId: "",dayScrollTops: [],
});
}
const date=String(patch.selectedDate || this.data.selectedDate);Object.assign(
patch,warm?.pager ||
makePager(tb,schedule.plans,date),);
}
hyd=sourceRevs(account);if (contentChanged) this.setWindow(patch);else if (Object.keys(patch).length) this.setData(patch);return true;
},scheduleBackgroundRefresh(delay:number) {clearRefresh();rt=setTimeout(() => {rt=undefined;if (!shown) return;void this.loadTimetable();void this.syncSchedule();
},delay);
},applyPrewarmedSchedule() {if (!shown) return false;const warm=getWarmScreen(acct);if (!warm || warm.revision === warmRev) {return false;
}
if (
warm.timetableStoredAt === tbStamp &&
warm.scheduleUpdatedAt === schedRev
) {warmRev=warm.revision;return false;
}
tb=addCourses(
warm.timetable,warm.schedule.courses,);warmRev=warm.revision;tbStamp=warm.timetableStoredAt;schedRev=warm.scheduleUpdatedAt;this.rebuildWeek();return true;
},async loadTimetable() {const lease=takeLease();if (!lease) return;if (tl && lc(tl)) {return;
}
tl=lease;let shouldRefreshAfterward=false;try {const result=await getPreloadedTimetable();if (
!result ||
!shown ||
!lc(lease) ||
acct !== lease.account
) {return;
}
const local=loadTimetableSnapshot(lease.account);if (shouldStoreServerSnapshot(local,result.meta)) {saveTimetableSnapshot(lease.account,result.data,{serverFetchedAt:result.meta.fetchedAt,deleted:result.meta.deleted,
});
}
this.applyPrewarmedSchedule();const current=loadTimetableSnapshot(lease.account);const storedAt=current?.localStoredAt || 0;if (storedAt !== tbStamp) {tb=addCourses(
current?.data || result.data,sch(acct).courses,);tbStamp=storedAt;this.rebuildWeek();
}
shouldRefreshAfterward =
isCacheStale(current,FIFTEEN_DAYS_MS) &&
claimAutomaticRefresh("timetable", lease.account);
} catch {
} finally {if (tl === lease) tl=null;if (shouldRefreshAfterward && lc(lease)) {setTimeout(() => {if (
shown &&
lc(lease) &&
acct === lease.account
) {void this.refreshTimetable();
}
},0);
}
}
},async refreshTimetable() {const lease=takeLease();if (!lease || acct !== lease.account) return;if (tl && lc(tl)) {return;
}
tl=lease;try {const result=await getTimetable({ refresh:true,automatic:true });if (!lc(lease) || acct !== lease.account) {return;
}
const local=loadTimetableSnapshot(lease.account);if (!shouldStoreServerSnapshot(local,result.meta,true)) return;tb=addCourses(
result.data,sch(acct).courses,);const snapshot=saveTimetableSnapshot(lease.account,result.data,{serverFetchedAt:result.meta.fetchedAt,deleted:result.meta.deleted,
});tbStamp=snapshot?.localStoredAt || Date.now();if (shown) this.rebuildWeek();
} catch {
} finally {if (tl === lease) tl=null;
}
},async syncSchedule() {const lease=takeLease();if (!lease || acct !== lease.account) return;if (sl && lc(sl)) return;sl=lease;try {await getPreloadedSchedule();if (
!shown ||
!lc(lease) ||
acct !== lease.account
) {return;
}
if (!this.applyPrewarmedSchedule()) {const updatedAt=sch(lease.account).clientUpdatedAt;if (updatedAt !== schedRev) {this.rebuildWeek();
}
}
} catch {
} finally {if (sl === lease) sl=null;
}
},persistPlans(plans: Plan[]) {const data = saveScheduleData(acct, plans);schedRev = data.clientUpdatedAt;void putLocalSchedule(data).catch(() => {wx.showToast({ title: "已保存在本机，稍后同步", icon: "none" });
});
},setWindow(patch:Record<string,unknown>,direction=0) {const motion=this._motion,old=motion?.position.value;this.decorate(patch);if (direction && this.data.motionClass !== "motion-reduced") patch.daySlide=direction > 0 ? "next" :"previous";if (motion) {motion.ready.value=0;motion.sequence.value += 1;if(direction&&this.data.monthOpen){motion.from.value=dayIx(this.data.selectedDate);motion.to.value=motion.from.value+direction}
}
const sequence=motion?.sequence.value;mv=true;this.setData({ dayAnimated:false },() => {if (this._motion !== motion || motion?.sequence.value !== sequence)
return;this._nativeCurrent=Number(patch.dayCurrent);this.setData(patch,() => {if (this._motion !== motion || motion?.sequence.value !== sequence)
return;this.syncOrb();if (motion) {const position=dayIx(this.data.selectedDate),animate=!!direction&&this.data.monthOpen&&this.data.motionClass!=="motion-reduced";motion.from.value=animate?old??position:position;motion.to.value=position;motion.start.value=position;motion.position.value=animate?wx.worklet.timing(position,{duration:260},()=>{}) as unknown as number:position;motion.active.value=0;
}
this._headerRendered=this.data.weekPages.length === 3;this.bindWeekMotion();this.setData({ dayAnimated:true },() => {if (this._motion !== motion || motion?.sequence.value !== sequence)
return;if (patch.daySlide) wx.nextTick(() => {if (motion?.sequence.value === sequence) this.setData({daySlide:""})});if (motion) motion.ready.value=1;mv=false;this.flushPendingDate();
});
});
});
},decorate(patch:Record<string,unknown>) {const date=String(patch.selectedDate || this.data.selectedDate);const plans=sch(acct).plans;const anchor=String(patch.monthAnchor || (date === this.data.selectedDate ? this.data.monthAnchor :date));Object.assign(patch,makeMonth(anchor,date,tb,plans,this.data.pg));if (this.data.monthOpen&&this.data.selectionVisible&&anchor.slice(0,7)!==date.slice(0,7))patch.selectionVisible=true;if (patch.weekPages) {patch.weekPages=markWeekPages(
patch.weekPages as ReturnType<typeof makePager>["weekPages"],tb,plans,);
}
},rebuildWeek(forceRebase=false) {if (mv || this._motion?.active.value) {dy=true;return;
}
const schedule=sch(acct);schedRev=schedule.clientUpdatedAt;const date=this.data.selectedDate;const current=this.data.dayPages.findIndex(
(day) => day.selectedDate === date,);const windowStart =
!forceRebase && current > 0 && current < 20
? this.data.dayPages[0].selectedDate
:undefined;const pager=makePager(
tb,schedule.plans,date,windowStart,);const patch={...makeDay(tb,schedule.plans,date),...pager,dayScrollTops:pager.dayPages.map(
(day) => sy.get(day.selectedDate) || 0,),
};dy=false;if (
forceRebase ||
pager.dayCurrent !== this.data.dayCurrent ||
pager.dayPages[0].selectedDate !== this.data.dayPages[0]?.selectedDate
) {this.setWindow(patch);
} else {this.decorate(patch);this.setData(patch);
}
markSources(acct, ["timetable", "schedule"]);
},onDayScrollStart() {"worklet";const motion = this._motion;if (!motion || !motion.ready.value) return;motion.from.value=motion.start.value;motion.to.value=motion.start.value;motion.active.value = 1;motion.sequence.value += 1;const markScroll = this.markScroll.bind(this);if (runOnJS) runOnJS(markScroll)(motion.sequence.value);
},onDayScrollUpdate(event: NativeScrollEvent) {"worklet";const motion = this._motion;if (!motion || !motion.ready.value || !motion.active.value) return;motion.position.value =
motion.start.value+event.detail.dx / motion.width.value;
},onDayScrollEnd(event: NativeScrollEvent) {"worklet";const motion = this._motion;if (!motion || !motion.ready.value || !motion.active.value) return;this.onDayScrollUpdate(event);const position = Math.round(motion.position.value);motion.start.value = position;motion.position.value = position;motion.active.value = 0;const endScroll = this.endScroll.bind(this);if (runOnJS) runOnJS(endScroll)(position, motion.sequence.value);
},markScroll(sequence: number) {if (this._motion && sequence !== this._motion.sequence.value) return;mv = true;this.setData({ focusedPlanId: "" });
},onDayChange(event:Event<{ current:number }>) {const windowStart=event.currentTarget.dataset.windowStart;if (this._motion && !this._motion.ready.value) return;if (windowStart && windowStart !== this.data.dayPages[0]?.selectedDate)
return;if (!this.data.dayPages[event.detail.current]) return;this._nativeCurrent=event.detail.current;
},endScroll(position:number,sequence:number) {const motion=this._motion;if (
!motion ||
!motion.ready.value ||
sequence !== motion.sequence.value ||
motion.active.value
)
return;const current=this._nativeCurrent;const day=this.data.dayPages[current];if (!day) return;const dayIndex=dayIx(day.selectedDate);const weekChanged=this.data.days[0]?.date !== day.days[0].date;if (motion && position !== dayIndex) {motion.start.value=dayIndex;motion.position.value=dayIndex;
}
mv=false;const anchor=this.data.monthAnchor,returnMonth=this.data.monthOpen&&anchor.slice(0,7)!==day.selectedDate.slice(0,7),calendarPatch=makeMonth(returnMonth?anchor:day.selectedDate,day.selectedDate,tb,sch(acct).plans,this.data.pg);calendarPatch.selectionVisible ||=returnMonth;this.setData({dayCurrent:current,selectedDate:day.selectedDate,days:day.days,selectedWeekday:day.selectedWeekday,selectedDateLabel:day.selectedDateLabel,teachingWeekLabel:day.teachingWeekLabel,monthLabel:day.monthLabel,entries:day.entries,...calendarPatch,
},() => {this.syncOrb();motion.to.value=dayIndex;if(returnMonth)this.turn(dayIx(day.selectedDate)>dayIx(anchor)?1:-1,day.selectedDate)});if (weekChanged || current === 0 || current === 20 || dy)
this.rebuildWeek();this.flushPendingDate();
},flushPendingDate() {if (mv || this._motion?.active.value) return;const next = pd;pd = "";if (next && next !== this.data.selectedDate)
this.goDate(next);else if (savedPlan?.date === this.data.selectedDate) {this.setData({ focusedPlanId:savedPlan.id });savedPlan=null;
}
},onGlassDayScroll(
this:CapsuleScrollHost,event:{detail:{ scrollTop:number };currentTarget?:{ dataset?:{ slot?:number } };
},) {"worklet";if (!this._capsuleDayScroll) return;const slot = Number(event.currentTarget?.dataset?.slot);if (!(slot >= 0)) return;const previous = this._capsuleDayScroll.value;if (slot >= previous.length || slot % 1 !== 0) return;const values: number[] = [];for (let index = 0; index < previous.length; index += 1)
values[index]=previous[index];values[slot]=event.detail.scrollTop;this._capsuleDayScroll.value=values;
},onDayVerticalScroll(
event: Event<{ scrollTop: number }>,) {const date = String(event.currentTarget.dataset.date || "");if (date) sy.set(date, event.detail.scrollTop);const slot = Number(event.currentTarget.dataset.slot);if (this._capsuleDayScroll && slot >= 0) {const values = this._capsuleDayScroll.value.slice();values[slot] = event.detail.scrollTop;this._capsuleDayScroll.value = values;
}
if (sy.size > 90)
sy.delete(sy.keys().next().value!);
},goDate(date:string) {if (mv || this._motion?.active.value) {pd=date;return;
}
if (date === this.data.selectedDate) return;const current=this.data.dayPages.findIndex(
(day) => day.selectedDate === date,);const distance=Math.abs(
dayIx(date)-dayIx(this.data.selectedDate),);if (
current < 0 ||
distance > 7 ||
this.data.monthOpen ||
this.data.motionClass === "motion-reduced"
) {const plans=sch(acct).plans;const pager=makePager(tb,plans,date);this.setWindow({...makeDay(tb,plans,date),...pager,dayScrollTops:pager.dayPages.map(
(day) => sy.get(day.selectedDate) || 0,),
},this.data.monthOpen ? dayIx(date)-dayIx(this.data.selectedDate) :0);return;
}
mv=true;this.setData({ dayCurrent:current });
},selectDay(event: Touch) {if (Date.now() < swipeEnd) return;savedPlan = null;const date = String(event.currentTarget.dataset.date || "");if (date) this.goDate(date);
},setCalendarMode(event: Touch) {const mode = String(event.currentTarget.dataset.mode || "");if (mode !== "week" && mode !== "month") return;if (this.data.monthOpen === (mode === "month")) return;haptic("light");this.setData({ monthOpen: mode === "month", foldProgress: mode === "month" ? 1 : 0 });
},toggleCalendarMode() {haptic("light");if (Date.now() < foldEnd) return;const expanded = !this.data.monthOpen;this.setData({ monthOpen: expanded, foldProgress: expanded ? 1 : 0 });
},turn(direction:number,target?:string) {if (!this.data.monthOpen||this._settling) return;this._settling=true;const selected=asDate(this.data.monthAnchor),picked=target?asDate(target):new Date(selected.getFullYear(),selected.getMonth()+direction,1,12),key=dateKey(new Date(picked.getFullYear(),picked.getMonth(),1,12)),width=this._motion?.weekWidth.value||wx.getWindowInfo().windowWidth*670/750,page=this.data.pg+direction,slot=direction>0?2:0,base=this._motion?.drag.value||0,show=key.slice(0,7)===this.data.selectedDate.slice(0,7);const slide=()=>this.setData({swiping:false,mx:-page*width-base},()=>setTimeout(()=>{if(this._motion)this._motion.shade.value=show?1:0;this.setData(makeMonth(key,this.data.selectedDate,tb,sch(acct).plans,page),()=>{this.syncOrb();this._settling=false})},this.data.motionClass==="motion-reduced"?0:300));const prep=()=>{if(target&&this.data.monthPanels[slot]?.monthAnchor.slice(0,7)!==key.slice(0,7))this.setData({[`monthPanels[${slot}]`]:{...makeGrid(key,this.data.selectedDate,tb,sch(acct).plans),id:slot,slot:page}},slide);else slide()};if(show){this.setData({monthOffset:page,selectionVisible:true},prep)}else prep();
},onCalendarFoldStart(event:Touch) {const touch=event.touches[0];if (touch) this._foldTouchStart={ y:touch.clientY,progress:this.data.foldProgress,moved:false };
},onCalendarFoldMove(event:Touch) {const start=this._foldTouchStart;const touch=event.touches[0];if (!start || !touch) return;const delta=touch.clientY-start.y;if (!start.moved && Math.abs(delta) < 4) return;start.moved=true;const span=this.data.monthHeight-128+76;const progress=Math.max(0,Math.min(1,start.progress+delta * 750 / wx.getWindowInfo().windowWidth / span));this.setData({ foldDragging:true,foldProgress:progress });
},onCalendarFoldEnd(event:Touch) {const start=this._foldTouchStart;this._foldTouchStart=null;if (!start?.moved) return;foldEnd=Date.now()+350;const touch=event.changedTouches[0];const delta=touch ? touch.clientY-start.y :0;const expanded=Math.abs(delta) > 20 ? delta > 0 :this.data.foldProgress >= .5;this.setData({ foldDragging:false,monthOpen:expanded,foldProgress:expanded ? 1 :0 });
},previousCalendarMonth() { this.turn(-1); },nextCalendarMonth() { this.turn(1); },monthStart(event:Touch) {const touch=event.touches[0];if (touch&&!this._settling) this._touchMonth={ x:touch.clientX,y:touch.clientY,b:this._motion?.drag.value||0 };
},monthMove(event:Touch) {const start=this._touchMonth,touch=event.touches[0];if (!start || !touch) return;const dx=touch.clientX-start.x,dy=touch.clientY-start.y;if (Math.abs(dx) < 5 || Math.abs(dx) < Math.abs(dy)*1.25) return;if(!this.data.swiping)this.setData({swiping:true});if(this._motion)this._motion.drag.value=start.b+dx;
},monthEnd(event:Touch) {const start=this._touchMonth;this._touchMonth=null;if (!start) return;const touch=event.changedTouches[0]||{clientX:start.x,clientY:start.y};const dx=touch.clientX-start.x,dy=touch.clientY-start.y;if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy)*1.25) {if(this._motion)this._motion.drag.value=wx.worklet.timing(start.b,{duration:260},()=>{}) as unknown as number;this.setData({swiping:false});return}swipeEnd=Date.now()+320;this.turn(dx < 0 ? 1 :-1);
},goToday() {savedPlan = null;haptic("light");this.goDate(dateKey(new Date()));
},openCreator() {haptic("light");const now = new Date();const nextStart = nextWholeHour(now);const startDate =
this.data.selectedDate === dateKey(now)
? nextStart.startDate
: this.data.selectedDate;const startTime = nextStart.startTime;const defaultEnd = defaultPlanEnd(startDate, startTime);this.setTabBarHidden(true);const draft = loadInteractionDraft(acct, "schedule");const periods = tb?.periods || [];const defaultWeek = tb
? timetableWeekForDisplay(tb)
: 1;const weekCount = tb ? timetableWeekCount(tb) : 0;this.setData({creating: true,creatorMode: "plan",creatorSheetHeight: 58,courseTimeOpen: false,courseWeeksOpen: false,courseTimeExpandHeight: 112 + Math.ceil(periods.length / 3) * 112,courseWeeksExpandHeight: 20 + Math.ceil(weekCount / 3) * 108,courseLocation: "",courseTeacher: "",savingCourse: false,editingCourseId: "",editingCourseDate: "",courseWeekdays: [wd(asDate(this.data.selectedDate))],courseWeekdayOptions: DAY_LABELS.map((label, index) => ({ weekday: index + 1, label, selected: index + 1 === wd(asDate(this.data.selectedDate)) })),coursePeriods: [],courseWeeks: [defaultWeek],coursePeriodOptions: periods.map((period) => ({period: period.period,
time: `${period.startTime}–${period.endTime}`,
selected:false,
})),courseWeekOptions: Array.from({ length: weekCount }, (_, index) => {const week = index + 1;const dates = weekDateKeys(tb, week);const start = dates[0]?.slice(5).replace("-", "/");const end = dates[6]?.slice(5).replace("-", "/");return {week,
dateLabel: start && end ? `${start}–${end}` : "日期待定",
selected:week === defaultWeek,
};
}),focusedPlanId: "",title: "",startDate,startTime,...defaultEnd,endDirty: false,...draft,editingPlanId: "",
});
},openPlanEditor(event: Touch) {if (String(event.currentTarget.dataset.kind || "") === "course") {const id = String(event.currentTarget.dataset.id || "");const course = sch(acct).courses.find((candidate) =>
id.startsWith(`${candidate.id}:arrangement-`),
);if (course) {this.openCreator();this.setData({creatorMode: "course",creatorSheetHeight: 70,editingPlanId: "",editingCourseId: course.id,editingCourseDate: String(event.currentTarget.dataset.date || ""),title: course.name,courseLocation: course.location,courseTeacher: course.teacher,courseWeekdays: course.weekdays?.length ? course.weekdays : [course.weekday],courseWeekdayOptions: this.data.courseWeekdayOptions.map((option) => ({...option,selected: (course.weekdays?.length ? course.weekdays : [course.weekday]).includes(option.weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7),
})),coursePeriods:course.periods,coursePeriodOptions:this.data.coursePeriodOptions.map((option) => ({ ...option,selected:course.periods.includes(option.period) })),courseWeeks:course.weeks,courseWeekOptions:this.data.courseWeekOptions.map((option) => ({ ...option,selected:course.weeks.includes(option.week) })),
});
} else if (id) {void navigateTo(
`/features/pages/timetable/index?source=schedule&courseId=${encodeURIComponent(id)}`,
"wx://cupertino-modal",);
}
return;
}
if (String(event.currentTarget.dataset.kind || "") !== "plan") return;const id = String(event.currentTarget.dataset.id || "");const plan = sch(acct).plans.find(
(candidate) => candidate.id === id,);if (!plan) return;haptic("light");this.setTabBarHidden(true);const draft = loadInteractionDraft(acct, "schedule", plan.id);this.setData({creating: true,creatorMode: "plan",creatorSheetHeight: 58,editingCourseId: "",editingCourseDate: "",focusedPlanId: "",editingPlanId: plan.id,title: plan.title,startDate: plan.date,startTime: plan.startTime,endDate: plan.endDate,endTime: plan.endTime,endDirty: true,...draft,
});
},saveCreatorDraft() {if (this.data.creatorMode === "course") return;const {title,startDate,startTime,endDate,endTime,endDirty,editingPlanId,
}=this.data;saveInteractionDraft(
acct,"schedule",{ title, startDate, startTime, endDate, endTime, endDirty },editingPlanId,);
},closeCreator() {this.setData({ creating: false, editingPlanId: "", editingCourseId: "", editingCourseDate: "" });this.setTabBarHidden(false);
},switchCreatorMode(event:Touch) {if (this.data.editingPlanId || this.data.editingCourseId) return;const creatorMode =
event.currentTarget.dataset.mode === "course" ? "course" : "plan";if (creatorMode === this.data.creatorMode) return;haptic("light");this.setData({creatorMode,title: "",creatorSheetHeight: creatorMode === "course" ? 70 : 58,
});
},toggleCourseTime() {const courseTimeOpen=!this.data.courseTimeOpen;this.setData({courseTimeOpen,creatorSheetHeight:courseTimeOpen || this.data.courseWeeksOpen ? 86 :70,
});
},toggleCourseWeeks() {const courseWeeksOpen=!this.data.courseWeeksOpen;this.setData({courseWeeksOpen,creatorSheetHeight:courseWeeksOpen || this.data.courseTimeOpen ? 86 :70,
});
},onCourseLocationInput(event:WechatMiniprogram.Input) {this.setData({ courseLocation:event.detail.value });
},onCourseTeacherInput(event:WechatMiniprogram.Input) {this.setData({ courseTeacher:event.detail.value });
},selectCourseWeekday(event:Touch) {const weekday=Number(event.currentTarget.dataset.weekday);const courseWeekdays=this.data.courseWeekdays.includes(weekday)
? this.data.courseWeekdays.filter((value) => value !== weekday)
:[...this.data.courseWeekdays,weekday].sort((a,b) => a-b);this.setData({ courseWeekdays,courseWeekdayOptions:this.data.courseWeekdayOptions.map((option) => ({ ...option,selected:courseWeekdays.includes(option.weekday) })) });
},toggleCoursePeriod(event:Touch) {const period=Number(event.currentTarget.dataset.period);const coursePeriods=this.data.coursePeriods.includes(period)
? this.data.coursePeriods.filter((value) => value !== period)
:[...this.data.coursePeriods,period].sort((a,b) => a-b);this.setData({coursePeriods,coursePeriodOptions:this.data.coursePeriodOptions.map((option) => ({...option,selected:coursePeriods.includes(option.period),
})),
});
},toggleCourseWeek(event:Touch) {const week=Number(event.currentTarget.dataset.week);const courseWeeks=this.data.courseWeeks.includes(week)
? this.data.courseWeeks.filter((value) => value !== week)
:[...this.data.courseWeeks,week].sort((a,b) => a-b);this.setData({courseWeeks,courseWeekOptions:this.data.courseWeekOptions.map((option) => ({...option,selected:courseWeeks.includes(option.week),
})),
});
},async saveCourse() {if (this.data.savingCourse) return;const name=this.data.title.trim();if (!name)
return void wx.showToast({ title: "请输入课程名", icon: "none" });if (!this.data.coursePeriods.length)
return void wx.showToast({ title: "请选择上课节次", icon: "none" });if (!this.data.courseWeekdays.length)
return void wx.showToast({ title: "请选择星期", icon: "none" });if (!this.data.courseWeeks.length)
return void wx.showToast({ title: "请选择周次", icon: "none" });if (!tb)
return void wx.showToast({ title: "课表尚未读取", icon: "none" });const existing = sch(acct);const editingCourseId = this.data.editingCourseId;const previous = editingCourseId
? existing.courses.find((item) => item.id === editingCourseId)
:undefined;if (editingCourseId && !previous)
return void wx.showToast({ title: "这门课程已删除", icon: "none" });const course: LocalScheduleCourse = {
id: previous?.id || `custom-${Date.now()}`,
semesterId:tb.semester.id,name,location:this.data.courseLocation.trim(),teacher:this.data.courseTeacher.trim(),weekday:this.data.courseWeekdays[0] as 1 | 2 | 3 | 4 | 5 | 6 | 7,weekdays:this.data.courseWeekdays as Array<1 | 2 | 3 | 4 | 5 | 6 | 7>,periods:this.data.coursePeriods,weeks:this.data.courseWeeks,excludedDates:previous?.excludedDates,
};this.setData({ savingCourse:true });await this.persistCourses(previous
? existing.courses.map((item) => item.id === previous.id ? course :item)
: [...existing.courses, course]);this.setData({ creating: false, title: "", savingCourse: false, editingCourseId: "", editingCourseDate: "" });this.setTabBarHidden(false);this.rebuildWeek();
},async persistCourses(courses:LocalScheduleCourse[]) {const existing=sch(acct);const data=saveScheduleData(acct,existing.plans,courses);schedRev=data.clientUpdatedAt;tb=addCourses(tb,data.courses);try {await putLocalSchedule(data);
} catch {wx.showToast({ title: "已保存在本机，稍后同步", icon: "none" });
}
},showDeleteCourseActions() {if (!this.data.editingCourseId || this.data.savingCourse) return;wx.showActionSheet({itemList: ["删除本次", "删除全部"],success: ({ tapIndex }) => {const all = tapIndex === 1;if (!all && !this.data.editingCourseDate) return;const lease = takeLease();if (!lease || lease.account !== acct) return;wx.showModal({title: all ? "删除课程" : "删除本次课程",content: all ? "确定删除这门课程的所有上课安排？" : "确定只删除这一天的课程？",confirmText: "删除",confirmColor: "#c0452d",success: (result) => {if (result.confirm && lc(lease))
void this.deleteCourse(all);
},
});
},
});
},async deleteCourse(all:boolean) {const id=this.data.editingCourseId;const date=this.data.editingCourseDate;const existing=sch(acct);const course=existing.courses.find((item) => item.id === id);if (!course || (!all && !date)) return;const courses=all
? existing.courses.filter((item) => item.id !== id)
:existing.courses.map((item) => item.id === id
? { ...item,excludedDates:[...new Set([...(item.excludedDates || []),date])].sort() }
: item);this.setData({ savingCourse: true });await this.persistCourses(courses);haptic("medium");this.setData({ creating: false, savingCourse: false, editingCourseId: "", editingCourseDate: "" });this.setTabBarHidden(false);this.rebuildWeek();
},onTitleInput(event:WechatMiniprogram.Input) {this.setData({ title:event.detail.value });this.saveCreatorDraft();
},onStartDateChange(event:Event<{ value:string }>) {const startDate=event.detail.value;this.setData(
this.data.endDirty
? { startDate }
:{ startDate,...defaultPlanEnd(startDate,this.data.startTime) },);this.saveCreatorDraft();
},onEndDateChange(event:Event<{ value:string }>) {this.setData({ endDate:event.detail.value,endDirty:true });this.saveCreatorDraft();
},onStartTimeChange(event:Event<{ value:string }>) {const startTime=event.detail.value;this.setData(
this.data.endDirty
? { startTime }
:{startTime,...defaultPlanEnd(this.data.startDate,startTime),
},);this.saveCreatorDraft();
},onEndTimeChange(event:Event<{ value:string }>) {this.setData({ endTime:event.detail.value,endDirty:true });this.saveCreatorDraft();
},savePlan() {if (!this.data.creating) return;const title = this.data.title.trim();if (!title) {wx.showToast({ title: "先写下要做什么", icon: "none" });return;
}
if (
this.data.endDate < this.data.startDate ||
(this.data.endDate === this.data.startDate &&
this.data.endTime <= this.data.startTime)
) {wx.showToast({ title: "结束时间需要晚于开始时间", icon: "none" });return;
}
const storedPlans=sch(acct).plans;const editingPlanId=this.data.editingPlanId;if (
editingPlanId &&
!storedPlans.some((plan) => plan.id === editingPlanId)
) {wx.showToast({ title: "这个日程已删除", icon: "none" });this.closeCreator();return;
}
const planPatch={title,date:this.data.startDate,startTime:this.data.startTime,endDate:this.data.endDate,endTime:this.data.endTime,
};
const savedPlanId = editingPlanId || `plan-${Date.now()}`;
const plans=editingPlanId
? storedPlans.map((plan) =>
plan.id === editingPlanId ? { ...plan,...planPatch } :plan,)
:[
...storedPlans,{id:savedPlanId,...planPatch,done:false,
},];this.persistPlans(plans);clearInteractionDraft(acct, "schedule", editingPlanId);haptic("medium");this.setData({creating: false,editingPlanId: "",focusedPlanId: savedPlanId,
});this.setTabBarHidden(false);if (mv || this._motion?.active.value) {savedPlan={ date:this.data.startDate,id:savedPlanId };pd=this.data.startDate;dy=true;return;
}
this.setData({ selectedDate:this.data.startDate });const selectedDate=asDate(this.data.startDate);this.setData({ selectedWeekday:wd(selectedDate) });this.rebuildWeek();
},deletePlan() {const editingPlanId = this.data.editingPlanId;if (!editingPlanId) return;const lease = takeLease();if (!lease || lease.account !== acct) return;wx.showModal({title: "删除日程",content: "确定删除这个日程？",confirmText: "删除",confirmColor: "#c0452d",success: (result) => {if (!result.confirm || !lc(lease)) return;const plans = sch(acct).plans.filter(
(plan) => plan.id !== editingPlanId,);this.persistPlans(plans);clearInteractionDraft(acct, "schedule", editingPlanId);haptic("medium");this.setData({ creating: false, editingPlanId: "" });this.setTabBarHidden(false);this.rebuildWeek();
},
});
},togglePlan(event: Touch) {const id = String(event.currentTarget.dataset.id || "");const plans = sch(acct).plans.map((plan) =>
plan.id === id ? { ...plan, done: !plan.done } : plan,);this.persistPlans(plans);haptic("light");this.rebuildWeek();
},
});
