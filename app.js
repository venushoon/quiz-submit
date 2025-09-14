function init() {
    console.log("페이지 로딩 완료, init 함수 실행.");

    const btnJoin = document.getElementById('btnJoin');
    const btnShortSend = document.getElementById('btnShortSend');
    const btnMyResult = document.getElementById('btnMyResult');
    
    let missingElements = [];

    if (!btnJoin) {
        missingElements.push('btnJoin');
        console.error("오류: 'btnJoin' 버튼을 찾을 수 없습니다!");
    } else {
        console.log("성공: 'btnJoin' 버튼을 찾았습니다.");
    }

    if (!btnShortSend) {
        missingElements.push('btnShortSend');
        console.error("오류: 'btnShortSend' 버튼을 찾을 수 없습니다!");
    } else {
        console.log("성공: 'btnShortSend' 버튼을 찾았습니다.");
    }

    if (!btnMyResult) {
        missingElements.push('btnMyResult');
        console.error("오류: 'btnMyResult' 버튼을 찾을 수 없습니다!");
    } else {
        console.log("성공: 'btnMyResult' 버튼을 찾았습니다.");
    }

    if (missingElements.length > 0) {
        alert(`오류 발생!\n\nindex.html 파일에서 다음 ID를 가진 요소를 찾을 수 없습니다:\n[${missingElements.join(', ')}]\n\n브라우저 캐시 문제일 수 있으니 강력 새로고침(Ctrl+F5 또는 Cmd+Shift+R)을 시도해보세요.`);
    } else {
        alert("성공! 모든 필수 버튼을 찾았습니다. 이제 원래 코드로 되돌려도 좋습니다.");
    }
}

document.addEventListener("DOMContentLoaded", init);
