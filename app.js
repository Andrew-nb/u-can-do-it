// ==================== GitHub Gist Cloud Sync ====================
class CloudSync {
    constructor(token) {
        // GIST_ID is fixed, token is passed from URL parameter
        this.GIST_ID = '93cf2f505010337d45d7cf9b740a4068';
        this.GH_TOKEN = token || '';
        this.FILENAME = 'self_discipline_data.json';
        this.userKey = 'default';

        this.enabled = !!(this.GIST_ID && this.GH_TOKEN);
        this.syncing = false;
        this.pushTimer = null;
    }

    setUserKey(key) {
        this.userKey = key;
    }

    isEnabled() {
        return this.enabled;
    }

    // Push local data to Gist
    async push(dataManager) {
        if (!this.enabled || this.syncing) return;
        this.syncing = true;
        this.updateStatus('syncing');

        try {
            // First get current Gist content to preserve other users' data
            const getRes = await fetch(`https://api.github.com/gists/${this.GIST_ID}`, {
                headers: {
                    'Authorization': `Bearer ${this.GH_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            let allData = {};
            if (getRes.ok) {
                const gist = await getRes.json();
                const file = gist.files[this.FILENAME];
                if (file && file.content) {
                    allData = JSON.parse(file.content);
                }
            }

            // Update only current user's data
            allData[this.userKey] = {
                sleepRecords: dataManager.getSleepRecords(),
                habitRecords: dataManager.getHabits(),
                missSnapshot: dataManager.getMissSnapshot(),
                lastSync: new Date().toISOString()
            };

            const res = await fetch(`https://api.github.com/gists/${this.GIST_ID}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${this.GH_TOKEN}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.v3+json'
                },
                body: JSON.stringify({
                    files: {
                        [this.FILENAME]: { content: JSON.stringify(allData, null, 2) }
                    }
                }),
            });

            if (!res.ok) throw new Error(`Push failed: ${res.status}`);
            this.updateStatus('success');
            console.log(`[CloudSync] Push success for user: ${this.userKey}`);
        } catch (e) {
            console.error('[CloudSync] Push error:', e);
            this.updateStatus('error');
        } finally {
            this.syncing = false;
        }
    }

    // Debounced push: wait 3s after last change
    debouncedPush(dataManager) {
        if (!this.enabled) return;
        clearTimeout(this.pushTimer);
        this.pushTimer = setTimeout(() => this.push(dataManager), 3000);
    }

    // Pull data from Gist to local
    async pull(dataManager) {
        if (!this.enabled) return false;
        this.syncing = true;
        this.updateStatus('syncing');

        try {
            const res = await fetch(`https://api.github.com/gists/${this.GIST_ID}`, {
                headers: {
                    'Authorization': `Bearer ${this.GH_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                },
            });

            if (!res.ok) throw new Error(`Pull failed: ${res.status}`);

            const gist = await res.json();
            const file = gist.files[this.FILENAME];
            if (!file || !file.content) {
                this.updateStatus('success');
                return false;
            }

            const allData = JSON.parse(file.content);
            const cloud = allData[this.userKey];
            if (!cloud) {
                this.updateStatus('success');
                return false;
            }

            // Merge sleep records (cloud as base, local overrides by date)
            if (cloud.sleepRecords && cloud.sleepRecords.length > 0) {
                const local = dataManager.getSleepRecords();
                const map = new Map();
                cloud.sleepRecords.forEach(r => map.set(r.date, r));
                local.forEach(r => map.set(r.date, r)); // local wins
                const merged = Array.from(map.values()).sort((a, b) => new Date(a.date) - new Date(b.date));
                localStorage.setItem(dataManager.SLEEP_KEY, JSON.stringify(merged));
            }

            // Merge habits (merge checkIns by union)
            if (cloud.habitRecords && cloud.habitRecords.length > 0) {
                const local = dataManager.getHabits();
                const map = new Map();
                cloud.habitRecords.forEach(h => map.set(h.id, { ...h }));
                local.forEach(h => {
                    if (map.has(h.id)) {
                        const existing = map.get(h.id);
                        const allCheckIns = new Set([...existing.checkIns, ...h.checkIns]);
                        existing.checkIns = Array.from(allCheckIns).sort();
                        // Local metadata wins
                        existing.name = h.name;
                        existing.type = h.type;
                        existing.weeklyGoal = h.weeklyGoal;
                    } else {
                        map.set(h.id, { ...h });
                    }
                });
                localStorage.setItem(dataManager.HABIT_KEY, JSON.stringify(Array.from(map.values())));
            }

            // Merge miss snapshot (cloud as base, local overrides)
            if (cloud.missSnapshot) {
                const localSnapshot = dataManager.getMissSnapshot();
                const merged = { ...cloud.missSnapshot, ...localSnapshot };
                dataManager.saveMissSnapshot(merged);
            }

            this.updateStatus('success');
            console.log(`[CloudSync] Pull success for user: ${this.userKey}`);
            return true;
        } catch (e) {
            console.error('[CloudSync] Pull error:', e);
            this.updateStatus('error');
            return false;
        } finally {
            this.syncing = false;
        }
    }

    // Update the sync indicator icon
    updateStatus(status) {
        const el = document.getElementById('syncIndicator');
        if (!el) return;

        const map = {
            syncing:  { icon: '🔄', tip: '同步中...', opacity: '1' },
            success:  { icon: '☁️', tip: '已同步', opacity: '1' },
            error:    { icon: '⚠️', tip: '同步失败', opacity: '0.8' },
            disabled: { icon: '📴', tip: '云同步未启用', opacity: '0.5' },
        };
        const s = map[status] || map.disabled;
        el.textContent = s.icon;
        el.title = s.tip;
        el.style.opacity = s.opacity;

        if (status === 'success') {
            setTimeout(() => { el.style.opacity = '0.5'; }, 2500);
        }
    }
}

// ==================== Data Manager Module ====================
class DataManager {
    constructor(userKey = 'default') {
        this.userKey = userKey;
        this.SLEEP_KEY = `sleepRecords_${userKey}`;
        this.HABIT_KEY = `habitRecords_${userKey}`;
        this.MISS_SNAPSHOT_KEY = `missSnapshot_${userKey}`;
    }

    // Get miss snapshot data { "2026-03-10": { miss: 2, hasHabits: true }, ... }
    getMissSnapshot() {
        const data = localStorage.getItem(this.MISS_SNAPSHOT_KEY);
        return data ? JSON.parse(data) : {};
    }

    // Save miss snapshot data
    saveMissSnapshot(snapshot) {
        localStorage.setItem(this.MISS_SNAPSHOT_KEY, JSON.stringify(snapshot));
    }

    // Get sleep records
    getSleepRecords() {
        const data = localStorage.getItem(this.SLEEP_KEY);
        return data ? JSON.parse(data) : [];
    }

    // Save sleep record
    saveSleepRecord(date, time) {
        const records = this.getSleepRecords();
        const existingIndex = records.findIndex(r => r.date === date);
        
        if (existingIndex >= 0) {
            records[existingIndex].time = time;
        } else {
            records.push({ date, time });
        }
        
        records.sort((a, b) => new Date(a.date) - new Date(b.date));
        localStorage.setItem(this.SLEEP_KEY, JSON.stringify(records));
        return records;
    }

    // Get today's sleep record
    getTodaySleepRecord() {
        const today = this.formatDate(new Date());
        const records = this.getSleepRecords();
        return records.find(r => r.date === today);
    }

    // Get habit list
    getHabits() {
        const data = localStorage.getItem(this.HABIT_KEY);
        return data ? JSON.parse(data) : [];
    }

    // Add habit (with createdAt field)
    addHabit(name, type, weeklyGoal) {
        const habits = this.getHabits();
        const newHabit = {
            id: Date.now().toString(),
            name,
            type, // 'daily' or 'weekly'
            weeklyGoal: type === 'daily' ? 7 : weeklyGoal,
            createdAt: this.formatDate(new Date()),
            checkIns: []
        };
        habits.push(newHabit);
        localStorage.setItem(this.HABIT_KEY, JSON.stringify(habits));
        return habits;
    }

    // Delete habit (snapshot miss data before deletion to preserve history)
    deleteHabit(habitId) {
        // Before deleting, snapshot all past dates' miss data
        this.snapshotMissBeforeDelete();

        const habits = this.getHabits();
        const filtered = habits.filter(h => h.id !== habitId);
        localStorage.setItem(this.HABIT_KEY, JSON.stringify(filtered));
        return filtered;
    }

    // Generate miss snapshot for all past dates (up to yesterday)
    snapshotMissBeforeDelete() {
        const habits = this.getHabits();
        if (habits.length === 0) return;

        const snapshot = this.getMissSnapshot();
        const todayStr = this.formatDate(new Date());

        // Find the earliest createdAt among all habits
        let earliest = todayStr;
        habits.forEach(h => {
            const created = h.createdAt || (h.checkIns.length > 0 ? h.checkIns[0] : null);
            if (created && created < earliest) earliest = created;
        });

        // Iterate from earliest date to yesterday
        const current = new Date(earliest);
        const todayDate = new Date(todayStr);

        while (current < todayDate) {
            const dateStr = this.formatDateSimple(current);
            // Only snapshot dates that haven't been snapshotted yet
            if (!snapshot[dateStr]) {
                const result = this._calcSnapshotForDate(dateStr, habits, todayStr);
                if (result.hasHabits) {
                    snapshot[dateStr] = { miss: result.miss, hasHabits: true };
                }
            }
            current.setDate(current.getDate() + 1);
        }

        this.saveMissSnapshot(snapshot);
    }

    // Calculate miss count for a specific date using provided habits array
    _calcSnapshotForDate(dateStr, habits, todayStr) {
        let hasHabits = false;
        let totalMiss = 0;

        if (dateStr >= todayStr) {
            return { hasHabits: false, miss: 0 };
        }

        habits.forEach(habit => {
            const habitCreatedAt = habit.createdAt
                ? habit.createdAt
                : (habit.checkIns.length > 0 ? habit.checkIns[0] : null);

            if (habit.type === 'daily') {
                if (!habitCreatedAt || dateStr < habitCreatedAt) return;
                hasHabits = true;
                if (!habit.checkIns.includes(dateStr)) {
                    totalMiss += 1;
                }
            } else if (habit.type === 'weekly') {
                const date = new Date(dateStr);
                const weekStart = this.getWeekStart(date);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekEnd.getDate() + 6);
                const weekEndStr = this.formatDateSimple(weekEnd);
                const weekStartStr = this.formatDateSimple(weekStart);

                if (!habitCreatedAt || habitCreatedAt > weekEndStr) return;
                hasHabits = true;

                // Only calculate weekly miss if the week is fully past
                if (todayStr <= weekEndStr) return;

                let weeklyCheckIns = 0;
                habit.checkIns.forEach(checkInDate => {
                    if (checkInDate >= weekStartStr && checkInDate <= weekEndStr) {
                        weeklyCheckIns++;
                    }
                });
                totalMiss += Math.max(0, habit.weeklyGoal - Math.min(weeklyCheckIns, habit.weeklyGoal));
            }
        });

        return { hasHabits, miss: totalMiss };
    }

    // Check in habit
    checkInHabit(habitId) {
        const habits = this.getHabits();
        const habit = habits.find(h => h.id === habitId);
        
        if (habit) {
            const today = this.formatDate(new Date());
            if (!habit.checkIns.includes(today)) {
                habit.checkIns.push(today);
                localStorage.setItem(this.HABIT_KEY, JSON.stringify(habits));
            }
        }
        return habits;
    }

    // Cancel today's check-in for a habit
    cancelCheckInHabit(habitId) {
        const habits = this.getHabits();
        const habit = habits.find(h => h.id === habitId);
        
        if (habit) {
            const today = this.formatDate(new Date());
            const index = habit.checkIns.indexOf(today);
            if (index > -1) {
                habit.checkIns.splice(index, 1);
                localStorage.setItem(this.HABIT_KEY, JSON.stringify(habits));
            }
        }
        return habits;
    }

    // Get weekly check-in count
    getWeeklyCheckIns(habit) {
        // Use logical date (before 4am counts as previous day)
        const now = new Date();
        const logicalDate = new Date(now);
        if (logicalDate.getHours() < 4) {
            logicalDate.setDate(logicalDate.getDate() - 1);
        }
        const weekStart = this.getWeekStart(logicalDate);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        
        // Compare using date strings to avoid timezone issues
        const weekStartStr = this.formatDateSimple(weekStart);
        const weekEndStr = this.formatDateSimple(weekEnd);
        
        return habit.checkIns.filter(date => {
            return date >= weekStartStr && date <= weekEndStr;
        }).length;
    }

    // Format date as YYYY-MM-DD without 4am logic (for date range comparison)
    formatDateSimple(date) {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // Check if today is checked in
    isTodayCheckedIn(habit) {
        const today = this.formatDate(new Date());
        return habit.checkIns.includes(today);
    }

    // Format date as YYYY-MM-DD (before 4am counts as previous day)
    formatDate(date) {
        const d = new Date(date);
        if (d.getHours() < 4) {
            d.setDate(d.getDate() - 1);
        }
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // Get week start date (Monday)
    getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(d.setDate(diff));
    }

    // Format time as HH:MM:SS
    formatTime(date) {
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    }
}

// ==================== Sleep Check-in Module ====================
class SleepModule {
    constructor(dataManager) {
        this.dataManager = dataManager;
        this.currentRange = 'week';
        this.chart = null;
        this.init();
    }

    init() {
        this.updateDateDisplay();
        this.loadTodayRecord();
        this.initChart();
        this.bindEvents();
        this.startClock();
        this.updateButtonState();
    }

    startClock() {
        this.updateClock();
        this.clockInterval = setInterval(() => {
            this.updateClock();
            this.updateButtonState();
        }, 1000);
    }

    updateClock() {
        const record = this.dataManager.getTodaySleepRecord();
        const timeDisplay = document.getElementById('sleepTimeDisplay');
        
        if (record) {
            timeDisplay.textContent = record.time;
        } else {
            const now = new Date();
            const time = this.dataManager.formatTime(now);
            timeDisplay.textContent = time;
        }
    }

    // Check if current time is within check-in window (21:00 - 03:59)
    isInCheckInTime() {
        const now = new Date();
        const hour = now.getHours();
        return hour >= 21 || hour < 4;
    }

    // Update button state (color)
    updateButtonState() {
        const btn = document.getElementById('sleepCheckInBtn');
        const record = this.dataManager.getTodaySleepRecord();
        
        btn.classList.remove('gray', 'active-time', 'checked-in');
        
        if (record) {
            btn.classList.add('checked-in');
        } else if (this.isInCheckInTime()) {
            btn.classList.add('active-time');
        } else {
            btn.classList.add('gray');
        }
    }

    updateDateDisplay() {
        const now = new Date();
        const hour = now.getHours();
        const dateStr = now.toLocaleDateString('zh-CN', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        const weekday = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][now.getDay()];

        // Greeting based on time: 4:00-11:59 morning, 12:00-13:59 noon, 14:00-17:59 afternoon, 18:00-3:59 evening
        let greetingText;
        if (hour >= 4 && hour < 12) {
            greetingText = '早上好';
        } else if (hour >= 12 && hour < 14) {
            greetingText = '中午好';
        } else if (hour >= 14 && hour < 18) {
            greetingText = '下午好';
        } else {
            greetingText = '晚上好';
        }

        // Get username from cloud_sync_user, fallback to '陌生人'
        const userName = localStorage.getItem('cloud_sync_user');
        const displayName = (userName && userName !== 'default') ? userName : '陌生人';

        document.getElementById('sleepGreeting').textContent = `${displayName}，${greetingText}`;
        document.getElementById('sleepDateLine').textContent = `${dateStr}  ${weekday}`;
    }

    loadTodayRecord() {
        const record = this.dataManager.getTodaySleepRecord();
        const timeDisplay = document.getElementById('sleepTimeDisplay');
        
        if (record) {
            timeDisplay.textContent = record.time;
        } else {
            const now = new Date();
            timeDisplay.textContent = this.dataManager.formatTime(now);
        }
        
        this.updateButtonState();
    }

    bindEvents() {
        document.getElementById('sleepCheckInBtn').addEventListener('click', () => {
            this.checkIn();
        });

        document.querySelectorAll('.time-range-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.time-range-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentRange = e.target.dataset.range;
                this.updateChart();
            });
        });
    }

    checkIn() {
        const record = this.dataManager.getTodaySleepRecord();
        
        if (record) {
            // Already checked in - ask to clear
            if (confirm('确定要重新打卡吗？')) {
                const today = this.dataManager.formatDate(new Date());
                const records = this.dataManager.getSleepRecords();
                const filtered = records.filter(r => r.date !== today);
                localStorage.setItem(this.dataManager.SLEEP_KEY, JSON.stringify(filtered));
                
                this.loadTodayRecord();
                this.updateChart();
                this.showToast('🔄 已清除打卡记录');
                if (window.cloudSync) window.cloudSync.debouncedPush(this.dataManager);
            }
        } else {
            // New check-in: block if outside time window
            if (!this.isInCheckInTime()) {
                this.showToast('⏰ 请在 21:00 ~ 04:00 之间打卡');
                return;
            }
            
            const now = new Date();
            const date = this.dataManager.formatDate(now);
            const time = this.dataManager.formatTime(now);
            
            this.dataManager.saveSleepRecord(date, time);
            this.loadTodayRecord();
            this.updateChart();
            
            this.showToast('✅ 打卡成功！');
            if (window.cloudSync) window.cloudSync.debouncedPush(this.dataManager);
        }
    }

    initChart() {
        const chartDom = document.getElementById('sleepChart');
        this.chart = echarts.init(chartDom);
        this.updateChart();
    }

    updateChart() {
        const records = this.dataManager.getSleepRecords();
        const { dates, times } = this.getChartData(records);

        // Determine display params based on time range and data count
        const isLongRange = this.currentRange === 'halfYear' || this.currentRange === 'year';
        const dataCount = dates.length;

        // Dynamic label interval: show fewer labels when data is dense
        let labelInterval = 0;
        let labelFontSize = 11;
        let symbolSize = 8;
        let lineWidth = 3;
        if (dataCount > 90) {
            labelInterval = Math.floor(dataCount / 15);
            labelFontSize = 9;
            symbolSize = 4;
            lineWidth = 2;
        } else if (dataCount > 30) {
            labelInterval = Math.floor(dataCount / 12);
            labelFontSize = 10;
            symbolSize = 6;
            lineWidth = 2.5;
        }

        // DataZoom: enable slider for half-year / year ranges
        const dataZoom = isLongRange ? [
            {
                type: 'slider',
                xAxisIndex: 0,
                start: dataCount > 30 ? Math.max(0, 100 - (30 / dataCount) * 100) : 0,
                end: 100,
                height: 20,
                bottom: 8,
                borderColor: '#ddd',
                fillerColor: 'rgba(79, 70, 229, 0.15)',
                handleStyle: { color: '#4f46e5' },
                textStyle: { fontSize: 10 }
            },
            {
                type: 'inside',
                xAxisIndex: 0,
                zoomOnMouseWheel: true,
                moveOnMouseMove: true
            }
        ] : [];

        const option = {
            tooltip: {
                trigger: 'axis',
                formatter: (params) => {
                    if (params && params.length > 0) {
                        const date = params[0].axisValue;
                        const records = this.dataManager.getSleepRecords();
                        const record = records.find(r => r.date.endsWith(date));
                        const timeStr = record ? record.time : '--:--:--';
                        return `${date}<br/>入睡时间: ${timeStr}`;
                    }
                    return '';
                }
            },
            xAxis: {
                type: 'category',
                data: dates,
                axisLabel: {
                    rotate: 45,
                    fontSize: labelFontSize,
                    interval: labelInterval
                }
            },
            yAxis: {
                type: 'value',
                min: 21,
                max: 28,
                interval: 1,
                axisLabel: {
                    formatter: (value) => {
                        if (value >= 24) {
                            return `${String(value - 24).padStart(2, '0')}:00`;
                        }
                        return `${String(value).padStart(2, '0')}:00`;
                    }
                }
            },
            dataZoom: dataZoom,
            series: [{
                data: times,
                type: 'line',
                smooth: true,
                symbol: 'circle',
                symbolSize: symbolSize,
                lineStyle: {
                    color: '#4f46e5',
                    width: lineWidth
                },
                itemStyle: {
                    color: '#4f46e5'
                },
                areaStyle: {
                    color: {
                        type: 'linear',
                        x: 0,
                        y: 0,
                        x2: 0,
                        y2: 1,
                        colorStops: [{
                            offset: 0,
                            color: 'rgba(79, 70, 229, 0.3)'
                        }, {
                            offset: 1,
                            color: 'rgba(79, 70, 229, 0.05)'
                        }]
                    }
                }
            }],
            grid: {
                left: '50',
                right: '20',
                bottom: isLongRange ? '80' : '60',
                top: '20'
            }
        };

        this.chart.setOption(option, true);
    }

    getChartData(records) {
        const now = new Date();
        let startDate;
        
        switch (this.currentRange) {
            case 'week':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 6);
                break;
            case 'month':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 29);
                break;
            case 'halfYear':
                startDate = new Date(now);
                startDate.setMonth(now.getMonth() - 6);
                break;
            case 'year':
                startDate = new Date(now);
                startDate.setFullYear(now.getFullYear() - 1);
                break;
        }
        
        const dates = [];
        const times = [];
        
        const current = new Date(startDate);
        while (current <= now) {
            const dateStr = this.dataManager.formatDate(current);
            const record = records.find(r => r.date === dateStr);
            
            if (record) {
                dates.push(dateStr.substring(5));
                const [hours, minutes] = record.time.split(':').map(Number);
                let timeValue = hours + minutes / 60;
                if (hours < 4) {
                    timeValue += 24;
                }
                times.push(timeValue);
            }
            
            current.setDate(current.getDate() + 1);
        }
        
        return { dates, times };
    }

    showToast(message) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            z-index: 1000;
            animation: fadeIn 0.3s ease-in;
        `;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease-out';
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }
}

// ==================== Habit Check-in Module ====================
class HabitModule {
    constructor(dataManager) {
        this.dataManager = dataManager;
        this.init();
    }

    init() {
        this.updateDateDisplay();
        this.renderHabits();
        this.bindEvents();
    }

    updateDateDisplay() {
        // Use logical date (before 4am counts as previous day)
        const now = new Date();
        const logicalDate = new Date(now);
        if (logicalDate.getHours() < 4) {
            logicalDate.setDate(logicalDate.getDate() - 1);
        }
        const dateStr = logicalDate.toLocaleDateString('zh-CN', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        
        const weekStart = this.dataManager.getWeekStart(logicalDate);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        
        const weekInfo = `本周：${weekStart.getMonth() + 1}月${weekStart.getDate()}日 - ${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`;
        
        document.getElementById('habitDate').textContent = dateStr;
        document.getElementById('habitWeekInfo').textContent = weekInfo;
    }

    bindEvents() {
        document.getElementById('addHabitBtn').addEventListener('click', () => {
            this.showAddModal();
        });

        document.getElementById('closeModalBtn').addEventListener('click', () => {
            this.hideAddModal();
        });

        document.getElementById('cancelModalBtn').addEventListener('click', () => {
            this.hideAddModal();
        });

        document.getElementById('habitType').addEventListener('change', () => {
            this.toggleFrequencyInput();
        });

        document.getElementById('addHabitForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addHabit();
        });

        document.getElementById('addHabitModal').addEventListener('click', (e) => {
            if (e.target.id === 'addHabitModal') {
                this.hideAddModal();
            }
        });
    }

    toggleFrequencyInput() {
        const type = document.getElementById('habitType').value;
        const frequencyGroup = document.getElementById('frequencyGroup');
        
        if (type === 'daily') {
            frequencyGroup.style.display = 'none';
        } else {
            frequencyGroup.style.display = 'block';
        }
    }

    showAddModal() {
        document.getElementById('addHabitModal').classList.add('active');
        document.getElementById('habitName').value = '';
        document.getElementById('habitType').value = 'weekly';
        document.getElementById('habitFrequency').value = '3';
        this.toggleFrequencyInput();
    }

    hideAddModal() {
        document.getElementById('addHabitModal').classList.remove('active');
    }

    addHabit() {
        const name = document.getElementById('habitName').value.trim();
        const type = document.getElementById('habitType').value;
        const frequency = parseInt(document.getElementById('habitFrequency').value);
        
        if (name && ((type === 'daily') || (type === 'weekly' && frequency >= 1 && frequency <= 7))) {
            this.dataManager.addHabit(name, type, frequency);
            this.renderHabits();
            this.hideAddModal();
            this.showToast('✅ 习惯添加成功！');
            if (window.cloudSync) window.cloudSync.debouncedPush(this.dataManager);
        }
    }

    // Sort habits: unchecked today on top, checked today on bottom;
    // within each group: daily first, then weekly; same type sorted by creation time
    sortHabits(habits) {
        return [...habits].sort((a, b) => {
            const aChecked = this.dataManager.isTodayCheckedIn(a) ? 1 : 0;
            const bChecked = this.dataManager.isTodayCheckedIn(b) ? 1 : 0;
            // Unchecked first
            if (aChecked !== bChecked) return aChecked - bChecked;
            // Within same group: daily before weekly
            if (a.type !== b.type) return a.type === 'daily' ? -1 : 1;
            // Same type: earlier created first
            return Number(a.id) - Number(b.id);
        });
    }

    // Capture current positions of all habit cards (FLIP: First)
    capturePositions() {
        const positions = new Map();
        const cards = document.querySelectorAll('.habit-card[data-habit-id]');
        cards.forEach(card => {
            const rect = card.getBoundingClientRect();
            positions.set(card.dataset.habitId, { top: rect.top, left: rect.left });
        });
        return positions;
    }

    // Apply FLIP animation: animate cards from old positions to new positions
    applyFlipAnimation(oldPositions) {
        const cards = document.querySelectorAll('.habit-card[data-habit-id]');
        cards.forEach(card => {
            const habitId = card.dataset.habitId;
            const oldPos = oldPositions.get(habitId);
            if (!oldPos) {
                // New card, fade in
                card.style.opacity = '0';
                card.style.transform = 'scale(0.9)';
                requestAnimationFrame(() => {
                    card.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
                    card.style.opacity = '1';
                    card.style.transform = 'scale(1)';
                    card.addEventListener('transitionend', () => {
                        card.style.transition = '';
                        card.style.transform = '';
                    }, { once: true });
                });
                return;
            }
            const newRect = card.getBoundingClientRect();
            const deltaX = oldPos.left - newRect.left;
            const deltaY = oldPos.top - newRect.top;
            if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;

            // Invert: move card back to old position
            card.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
            card.style.transition = 'none';

            // Play: animate to new position
            requestAnimationFrame(() => {
                card.style.transition = 'transform 0.45s cubic-bezier(0.25, 0.8, 0.25, 1)';
                card.style.transform = 'translate(0, 0)';
                card.addEventListener('transitionend', () => {
                    card.style.transition = '';
                    card.style.transform = '';
                }, { once: true });
            });
        });
    }

    renderHabits(animate = false) {
        const habits = this.dataManager.getHabits();
        const habitList = document.getElementById('habitList');
        const emptyState = document.getElementById('emptyHabitState');
        
        if (habits.length === 0) {
            habitList.innerHTML = '';
            emptyState.classList.remove('hidden');
            return;
        }
        
        emptyState.classList.add('hidden');
        
        // Capture old positions for FLIP animation
        let oldPositions = null;
        if (animate) {
            oldPositions = this.capturePositions();
        }
        
        const sortedHabits = this.sortHabits(habits);
        
        habitList.innerHTML = sortedHabits.map(habit => this.createHabitCard(habit)).join('');
        
        // Apply FLIP animation
        if (animate && oldPositions) {
            this.applyFlipAnimation(oldPositions);
        }
        
        // Bind check-in, cancel and delete events
        habits.forEach(habit => {
            const checkInBtn = document.getElementById(`checkIn-${habit.id}`);
            const cancelBtn = document.getElementById(`cancel-${habit.id}`);
            const deleteBtn = document.getElementById(`delete-${habit.id}`);
            
            if (checkInBtn) {
                checkInBtn.addEventListener('click', () => {
                    this.checkInHabit(habit.id);
                });
            }

            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    this.cancelCheckIn(habit.id);
                });
            }
            
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                    this.deleteHabit(habit.id);
                });
            }
        });
    }

    createHabitCard(habit) {
        const isCheckedToday = this.dataManager.isTodayCheckedIn(habit);
        const typeText = habit.type === 'daily' ? '每天打卡' : `每周 ${habit.weeklyGoal} 次`;

        if (habit.type === 'daily') {
            // === Daily habit: no progress bar, only check-in status ===
            let actionArea = '';
            if (isCheckedToday) {
                actionArea = `
                    <div class="flex space-x-2">
                        <div class="flex-1 bg-green-50 text-green-700 text-center py-3 rounded-lg font-medium">
                            ✅ 今日已打卡
                        </div>
                        <button id="cancel-${habit.id}" class="cancel-checkin-btn px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg font-medium text-sm">
                            撤回
                        </button>
                    </div>
                `;
            } else {
                actionArea = `
                    <button id="checkIn-${habit.id}" class="check-in-btn w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-bold py-3 rounded-lg transition-all">
                        立即打卡
                    </button>
                `;
            }

            return `
                <div class="habit-card" data-habit-id="${habit.id}">
                    <div class="flex justify-between items-start mb-4">
                        <div>
                            <h4 class="text-xl font-bold text-gray-800 mb-1">${habit.name}</h4>
                            <p class="text-sm text-gray-500">${typeText}</p>
                        </div>
                        <button id="delete-${habit.id}" class="delete-btn">删除</button>
                    </div>
                    ${actionArea}
                </div>
            `;
        } else {
            // === Weekly habit: show progress bar ===
            const weeklyCount = this.dataManager.getWeeklyCheckIns(habit);
            const progress = (weeklyCount / habit.weeklyGoal) * 100;
            const isCompleted = weeklyCount >= habit.weeklyGoal;

            let actionArea = '';
            if (isCompleted) {
                if (isCheckedToday) {
                    actionArea = `
                        <div class="flex space-x-2">
                            <div class="flex-1 bg-green-50 text-green-700 text-center py-3 rounded-lg font-medium">
                                🎉 本周目标已完成！
                            </div>
                            <button id="cancel-${habit.id}" class="cancel-checkin-btn px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg font-medium text-sm">
                                撤回
                            </button>
                        </div>
                    `;
                } else {
                    actionArea = `
                        <div class="bg-green-50 text-green-700 text-center py-3 rounded-lg font-medium mb-3">
                            🎉 本周目标已完成！
                        </div>
                        <button id="checkIn-${habit.id}" class="extra-checkin-btn w-full font-bold py-3 rounded-lg transition-all">
                            额外打卡
                        </button>
                    `;
                }
            } else if (isCheckedToday) {
                actionArea = `
                    <div class="flex space-x-2">
                        <div class="flex-1 bg-blue-50 text-blue-700 text-center py-3 rounded-lg font-medium">
                            ✅ 今日已打卡
                        </div>
                        <button id="cancel-${habit.id}" class="cancel-checkin-btn px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg font-medium text-sm">
                            撤回
                        </button>
                    </div>
                `;
            } else {
                actionArea = `
                    <button id="checkIn-${habit.id}" class="check-in-btn w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-bold py-3 rounded-lg transition-all">
                        立即打卡
                    </button>
                `;
            }

            return `
                <div class="habit-card" data-habit-id="${habit.id}">
                    <div class="flex justify-between items-start mb-4">
                        <div>
                            <h4 class="text-xl font-bold text-gray-800 mb-1">${habit.name}</h4>
                            <p class="text-sm text-gray-500">${typeText}</p>
                        </div>
                        <button id="delete-${habit.id}" class="delete-btn">删除</button>
                    </div>
                    
                    <div class="mb-4">
                        <div class="flex justify-between items-center mb-2">
                            <span class="text-sm font-medium text-gray-700">本周进度</span>
                            <span class="text-sm font-bold ${isCompleted ? 'text-green-600' : 'text-indigo-600'}">
                                ${weeklyCount} / ${habit.weeklyGoal}
                            </span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${Math.min(progress, 100)}%"></div>
                        </div>
                    </div>
                    
                    ${actionArea}
                </div>
            `;
        }
    }

    checkInHabit(habitId) {
        this.dataManager.checkInHabit(habitId);
        this.renderHabits(true);
        this.showToast('✅ 打卡成功！');
        if (window.cloudSync) window.cloudSync.debouncedPush(this.dataManager);
    }

    cancelCheckIn(habitId) {
        if (confirm('确定要撤回今日打卡吗？')) {
            this.dataManager.cancelCheckInHabit(habitId);
            this.renderHabits(true);
            this.showToast('↩️ 已撤回今日打卡');
            if (window.cloudSync) window.cloudSync.debouncedPush(this.dataManager);
        }
    }

    deleteHabit(habitId) {
        if (confirm('确定要删除这个习惯吗？')) {
            this.dataManager.deleteHabit(habitId);
            this.renderHabits();
            this.showToast('🗑️ 习惯已删除');
            if (window.cloudSync) window.cloudSync.debouncedPush(this.dataManager);
        }
    }

    showToast(message) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            z-index: 1000;
            animation: fadeIn 0.3s ease-in;
        `;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease-out';
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }
}

// ==================== Check-in Records Module ====================
class RecordModule {
    constructor(dataManager) {
        this.dataManager = dataManager;
        this.currentDate = new Date();
        this.init();
    }

    init() {
        this.renderCalendar();
        this.bindEvents();
    }

    bindEvents() {
        document.getElementById('prevMonth').addEventListener('click', () => {
            this.currentDate.setMonth(this.currentDate.getMonth() - 1);
            this.renderCalendar();
        });

        document.getElementById('nextMonth').addEventListener('click', () => {
            this.currentDate.setMonth(this.currentDate.getMonth() + 1);
            this.renderCalendar();
        });
    }

    renderCalendar() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        
        document.getElementById('currentMonth').textContent = `${year}年${month + 1}月`;
        
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const totalDays = lastDay.getDate();
        
        let firstDayOfWeek = firstDay.getDay();
        firstDayOfWeek = firstDayOfWeek === 0 ? 7 : firstDayOfWeek;
        
        const calendarGrid = document.getElementById('calendarGrid');
        const weekHeaders = Array.from(calendarGrid.querySelectorAll('div')).slice(0, 7);
        calendarGrid.innerHTML = '';
        weekHeaders.forEach(header => calendarGrid.appendChild(header));
        
        for (let i = 1; i < firstDayOfWeek; i++) {
            const emptyDay = document.createElement('div');
            emptyDay.className = 'calendar-day empty';
            calendarGrid.appendChild(emptyDay);
        }
        
        const today = new Date();
        const todayStr = this.dataManager.formatDate(today);
        
        for (let day = 1; day <= totalDays; day++) {
            const date = new Date(year, month, day);
            const dateStr = this.dataManager.formatDateSimple(date);
            
            const dayDiv = document.createElement('div');
            dayDiv.className = 'calendar-day';
            
            // Today or future: show as gray (unsettled)
            if (dateStr >= todayStr) {
                dayDiv.classList.add('future');
                if (dateStr === todayStr) {
                    dayDiv.classList.add('today');
                }
                dayDiv.innerHTML = `
                    <div class="day-number">${day}</div>
                `;
            } else {
                // Past date: check if any habits exist for this day
                const hasHabits = this.hasHabitsOnDate(dateStr);
                
                if (!hasHabits) {
                    // No habits associated with this day: gray
                    dayDiv.classList.add('future');
                    dayDiv.innerHTML = `
                        <div class="day-number">${day}</div>
                    `;
                } else {
                    // Has habits: calculate miss count and show color
                    const missCount = this.calculateDailyMissCount(dateStr);
                    const level = this.getMissLevel(missCount);
                    dayDiv.classList.add(`level-${level}`);
                    
                    dayDiv.innerHTML = `
                        <div class="day-number">${day}</div>
                        <div class="miss-count">${missCount === 0 ? '完美' : '缺卡' + missCount + '次'}</div>
                    `;
                }
            }
            
            calendarGrid.appendChild(dayDiv);
        }
        
        const totalCells = firstDayOfWeek - 1 + totalDays;
        const remainingCells = totalCells % 7;
        if (remainingCells > 0) {
            for (let i = 0; i < 7 - remainingCells; i++) {
                const emptyDay = document.createElement('div');
                emptyDay.className = 'calendar-day empty';
                calendarGrid.appendChild(emptyDay);
            }
        }
    }

    // Check if any habits (daily or weekly) are associated with a given date
    hasHabitsOnDate(dateStr) {
        // Priority: check snapshot first (preserves history after habit deletion)
        const snapshot = this.dataManager.getMissSnapshot();
        if (snapshot[dateStr]) {
            return snapshot[dateStr].hasHabits;
        }

        const habits = this.dataManager.getHabits();
        
        for (const habit of habits) {
            const habitCreatedAt = habit.createdAt 
                ? habit.createdAt 
                : (habit.checkIns.length > 0 ? habit.checkIns[0] : null);
            
            if (!habitCreatedAt) continue;
            
            if (habit.type === 'daily') {
                // Daily habit: exists if created on or before this date
                if (habitCreatedAt <= dateStr) {
                    return true;
                }
            } else if (habit.type === 'weekly') {
                // Weekly habit: check if habit was created on or before the end of this week
                const date = new Date(dateStr);
                const weekStart = this.dataManager.getWeekStart(date);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekEnd.getDate() + 6);
                const weekEndStr = this.dataManager.formatDateSimple(weekEnd);
                
                if (habitCreatedAt <= weekEndStr) {
                    return true;
                }
            }
        }
        
        return false;
    }

    // Calculate daily miss count for a given date
    calculateDailyMissCount(dateStr) {
        // Priority: check snapshot first (preserves history after habit deletion)
        const snapshot = this.dataManager.getMissSnapshot();
        if (snapshot[dateStr]) {
            return snapshot[dateStr].miss;
        }

        const habits = this.dataManager.getHabits();
        let totalMiss = 0;
        
        const todayStr = this.dataManager.formatDate(new Date());
        
        // Today or future: not yet settled
        if (dateStr >= todayStr) {
            return 0;
        }
        
        habits.forEach(habit => {
            // Use createdAt field, fallback to first check-in date for legacy data
            const habitCreatedAt = habit.createdAt 
                ? habit.createdAt 
                : (habit.checkIns.length > 0 ? habit.checkIns[0] : null);
            
            if (habit.type === 'daily') {
                // Daily habit: must be created on or before dateStr
                if (!habitCreatedAt || dateStr < habitCreatedAt) {
                    return;
                }
                if (!habit.checkIns.includes(dateStr)) {
                    totalMiss += 1;
                }
            } else if (habit.type === 'weekly') {
                // Weekly habit: check by week range
                const date = new Date(dateStr);
                const weekStart = this.dataManager.getWeekStart(date);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekEnd.getDate() + 6);
                const weekEndStr = this.dataManager.formatDateSimple(weekEnd);
                
                // Habit must exist within this week (created on or before week end)
                if (!habitCreatedAt || habitCreatedAt > weekEndStr) {
                    return;
                }
                
                const weekMiss = this.calculateWeeklyMiss(habit, dateStr, todayStr);
                totalMiss += weekMiss;
            }
        });
        
        return totalMiss;
    }

    // Calculate weekly miss for a specific day
    // Note: caller already ensures habit exists within this week range
    calculateWeeklyMiss(habit, dateStr, todayStr) {
        const date = new Date(dateStr);
        const weekStart = this.dataManager.getWeekStart(date);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        
        // Week end string (Sunday) for comparison
        const weekEndStr = this.dataManager.formatDateSimple(weekEnd);
        const weekStartStr = this.dataManager.formatDateSimple(weekStart);
        
        // The week is settled on the next Monday at 4am, i.e., todayStr > weekEndStr
        if (todayStr <= weekEndStr) {
            return 0;
        }
        
        // Count actual check-ins for that week (only count up to weeklyGoal for miss calculation)
        let weeklyCheckIns = 0;
        habit.checkIns.forEach(checkInDate => {
            if (checkInDate >= weekStartStr && checkInDate <= weekEndStr) {
                weeklyCheckIns++;
            }
        });
        
        // Total miss for the entire week (extra check-ins don't affect miss count)
        const totalMiss = Math.max(0, habit.weeklyGoal - Math.min(weeklyCheckIns, habit.weeklyGoal));
        
        return totalMiss;
    }

    // Map miss count to color level (0-3)
    getMissLevel(missCount) {
        if (missCount === 0) return 0;  // green: perfect
        if (missCount === 1) return 1;  // yellow: 1 miss
        if (missCount <= 3) return 2;   // orange: 2-3 misses
        return 3;                        // red: 4+ misses
    }
}

// ==================== Navigation Module ====================
class NavigationModule {
    constructor() {
        this.init();
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
        document.getElementById('navSleep').addEventListener('click', () => {
            this.switchPage('sleep');
        });

        document.getElementById('navHabit').addEventListener('click', () => {
            this.switchPage('habit');
        });

        document.getElementById('navRecord').addEventListener('click', () => {
            this.switchPage('record');
        });
    }

    switchPage(page) {
        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
        
        document.getElementById('sleepPage').classList.remove('active');
        document.getElementById('habitPage').classList.remove('active');
        document.getElementById('recordPage').classList.remove('active');
        
        if (page === 'sleep') {
            document.getElementById('navSleep').classList.add('active');
            document.getElementById('sleepPage').classList.add('active');
        } else if (page === 'habit') {
            document.getElementById('navHabit').classList.add('active');
            document.getElementById('habitPage').classList.add('active');
        } else if (page === 'record') {
            document.getElementById('navRecord').classList.add('active');
            document.getElementById('recordPage').classList.add('active');
        }
    }
}

// ==================== App Initialization ====================
document.addEventListener('DOMContentLoaded', async () => {
    // Parse token and user from URL parameters, with localStorage fallback
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    const urlUser = urlParams.get('user');

    let token, userKey;
    if (urlToken) {
        // URL has token, save to localStorage for future use
        token = urlToken;
        userKey = urlUser || 'default';
        localStorage.setItem('cloud_sync_token', token);
        localStorage.setItem('cloud_sync_user', userKey);
        console.log('🔑 Token saved to localStorage for future use');
    } else {
        // No URL token, try to read from localStorage
        token = localStorage.getItem('cloud_sync_token') || '';
        userKey = localStorage.getItem('cloud_sync_user') || 'default';
        if (token) {
            console.log('🔑 Token loaded from localStorage');
        }
    }

    // Dynamically generate manifest with token in start_url (for iOS standalone mode)
    const manifestObj = {
        name: "自律",
        short_name: "自律",
        description: "自律打卡应用",
        start_url: token
            ? `./index.html?token=${encodeURIComponent(token)}&user=${encodeURIComponent(userKey)}`
            : "./index.html",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#4f46e5",
        icons: [
            { src: "icon-v2.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
            { src: "icon-v2.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
        ]
    };
    const manifestBlob = new Blob([JSON.stringify(manifestObj)], { type: 'application/json' });
    const manifestUrl = URL.createObjectURL(manifestBlob);
    const manifestLink = document.createElement('link');
    manifestLink.rel = 'manifest';
    manifestLink.href = manifestUrl;
    document.head.appendChild(manifestLink);

    const dataManager = new DataManager(userKey);

    // Initialize cloud sync with token from URL
    const cloudSync = new CloudSync(token);
    cloudSync.setUserKey(userKey);
    window.cloudSync = cloudSync;

    // Pull cloud data first, then initialize UI
    if (cloudSync.isEnabled()) {
        await cloudSync.pull(dataManager);
    } else {
        cloudSync.updateStatus('disabled');
    }

    const sleepModule = new SleepModule(dataManager);
    const habitModule = new HabitModule(dataManager);
    const recordModule = new RecordModule(dataManager);
    const navigationModule = new NavigationModule();

    // Click sync indicator to manually trigger sync
    document.getElementById('syncIndicator')?.addEventListener('click', async () => {
        if (!cloudSync.isEnabled()) {
            alert('云同步未启用\n\n请在代码中填入 GIST_ID 和 GH_TOKEN');
            return;
        }
        const pulled = await cloudSync.pull(dataManager);
        if (pulled) {
            sleepModule.loadTodayRecord();
            sleepModule.updateChart();
            sleepModule.updateButtonState();
            habitModule.renderHabits();
            recordModule.renderCalendar();
        }
        await cloudSync.push(dataManager);
        alert('同步完成 ✅');
    });

    console.log(`自律 App 已启动！用户: ${userKey}`);
    if (cloudSync.isEnabled()) {
        console.log('☁️ GitHub Gist 云同步已启用');
    } else {
        console.log('💾 本地模式（填入 GIST_ID 和 GH_TOKEN 可启用云同步）');
    }
});
